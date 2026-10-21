// Volume rendering of a model of a protoplanetary disk (out to its edge at 30 au), drawn on the GPU.
//
// The structure follows an irradiated, magnetically accreting disk:
//   gas        Σ ∝ R^-1 out to a density cutoff at 30 au, vertically Gaussian with H/R = 0.045 (R/au)^1/4 (0.03 until
//              round 8 of Disk Lab v2: drawn thicker than its temperature would hold up, see MODEL); the
//              tapering edge lies in the shadow of the flared disk
//   rotation   Keplerian, Ω ∝ R^-3/2
//   coupling   the gas is weakly ionized, so the field slips through it (non-ideal MHD, see NONIDEAL): Ohmic
//              diffusion leaves a dead zone about the midplane, and ambipolar diffusion keeps the surface above it
//              laminar; only the thermally ionized innermost disk (inside 0.3 au) is turbulent (the
//              magnetorotational instability), in sheared structure and eddies in three dimensions through the
//              whole column (see CELLS3); beyond about 10 au, where the whole column couples, weakly (OUTER_TURB)
//   heating    starlight grazes the flared surface and is absorbed where the optical depth toward
//              the star reaches unity, a few scale heights up; the grains there are superheated, while the
//              interior is warmed by their reprocessed light (158 K at 1 au); accretion heats it little, as the
//              accretion of a magnetically accreting disk releases its heat high up, except in the turbulent inner
//              disk, so the water snow line sits near 1 au (see THERMO)
//   dust       large grains settle into a thin layer at the midplane; they are icy where
//              T < 160 K, bare rock inside, with a modest pile-up of ice just outside the
//              snow line from re-condensing vapor
//   wind       a magnetically driven wind leaves the irradiated surface along the field lines of a
//              self-similar MHD wind solution, with its density and flow speed; by default stronger on one side,
//              as for a field aligned with the rotation (Mori, Bai & Tomida 2025), or symmetric (see opt.asym)
//   inner edge dust sublimates inside about 0.08 au
//   planet     a Jupiter-mass planet at 3 au opens a gap; pebbles collect at its outer edge (see PLANET)
//   envelope   the remains of the parent cloud fall onto the disk along the streamlines of a rotating collapse
//              (Ulrich 1976), with a cavity along the axis; shown from afar (see ENV)
// Rendering: the irradiated skin, far thinner than a ray step, is integrated analytically through
// its profile of absorbed starlight (bright where seen at a grazing angle; corrugations that face
// the star catch more light and cast shadows behind them). The skin, the wind and the field lines are
// lit as scattered starlight, with a phase function in the angle star -> point -> observer (near-
// isotropic for the disk, strongly forward for the small grains in the wind); the settled dust is a
// sheet crossed analytically at the midplane. The turbulent factors and the field line through each point
// are read from two maps (see MAP_GLSL) and the eddies from a volume texture (see TURB3_FS), so a step of the
// march costs a few texture fetches. The
// gas is drawn translucent (a real disk is opaque at visible wavelengths) so that the dust sheet and
// the snow line show through. Colour encodes temperature: amber where it is warm (inner disk,
// irradiated surface), blue where it is cold (outer midplane); icy dust is pale, rocky dust dark.
// Brightness follows the absorbed starlight with a softened falloff beyond 1 au and an asinh stretch.
// Clicking drops a clump of pebbles: it shears out, drifts inward and loses its ice inside
// the snow line; the vapor spreads outward and freezes again. Clicking the star sets off an FU Orionis
// outburst (see burstL); with the planet turned off, pebbles dropped near 3 au grow it back.
// Looks: the model's quantities as they are (the default), or as the disk would be seen at a wavelength: scattered
// light (optical, near-infrared), the warm surface's thermal emission (mid-infrared), the pebbles' thermal emission
// (millimetre), and the rotational line of carbon monoxide (channel maps and moments). See uLook.
// This is a schematic model for the website, not simulation output.
(function () {
  // Magnetic field lines, shared by the volume (wind gas) and the line pass. They come from a numerical
  // solution of steady, axisymmetric, ideal MHD for a cold magnetocentrifugal wind: the self-similar
  // problem of Blandford & Payne (1982), with induction, momentum and mass conservation solved together
  // and the solution passing smoothly through the Alfven point. Lever arm lambda = 3 with heavy mass
  // loading kappa = 2.0, as for the winds of protoplanetary disks (the paper's example has lambda = 30);
  // computed by tools/bp-wind and tabulated in BP below.
  // Self-similarity makes every line the same curve scaled by the radius r0 where it leaves the disk
  // surface (at height z_base):
  //   R = r0 xi(chi),  z = z_base + r0 chi,  phi = phi_foot + Omega_K(r0) t + PHI(chi)
  //   At the surface the line leans 64 deg from the axis (dR/dz = 2.06; a cold wind needs more than 30).
  //   Gas accelerates along it and passes the Alfven speed at chi = 0.46, R = sqrt(lambda) r0 = 1.7 r0.
  //   Beyond that the hoop stress of the wound-up field collimates the flow: 53 deg from the axis at the
  //   Alfven point, 19 deg at chi = 10 and 2.5 deg at chi = 39. The radius peaks at 11.9 r0 (chi = 53)
  //   and the line then turns back toward the axis, beyond the picture; the table stops at chi = 60
  //   (the solution goes on to chi = 134).
  //   Each line co-rotates with its foot (Ferraro) and lags behind the rotation as it rises. This is a
  //   steady state: the winding by the rotation is balanced by the wind carrying the toroidal field away,
  //   B_phi = (v_phi - Omega_K(r0) R) B_p / v_p, so the twist does not grow with time.
  //   B_phi/B_z = -kappa (lambda - 1) = -4.0 at the surface, B_phi/B_p = -2.3 at the Alfven point and
  //   -5.7 at chi = 10, where the slow wind (1.2 v_K(r0)) has wound the line back by 11.5 rad.
  //   TAU is the travel time of a gas parcel from chi = 0.02, in units of 1/Omega_K(r0).
  //   The gas density along a line is rho0(r0) ETA(chi) with rho0 ∝ r0^-3/2 (ETA = kappa / (xi J f), mass
  //   conservation along the flux tube), and the velocity v_K(r0) (F dxi/dchi, G, F) in (R, phi, z).
  //   ETA falls 23-fold from chi = 0.03 to the Alfven point and 61-fold to chi = 1 as the gas accelerates,
  //   then 4.5-fold from 1 to 3 and 5.4-fold from 3 to 10.
  // Inside the disk the line is vertical where the field does not couple to the gas (the dead zone, see NONIDEAL) and
  // bends into the wind above it. Lines are labelled by their foot radius Rf at the midplane; below the midplane they
  // are mirrored.
  // (Disk Lab v2, round 8, the owner: "make the whole disk about 1.5 times thicker". H0, H/R at 1 au, 0.03 -> 0.045: the
  // model's own scale height, so that everything built on it follows (the irradiation surface, the wind's base, the dead
  // zone, the gaps, the planets' wakes, the grazing angle of the starlight and with it the temperature). A stated choice
  // for the picture: the temperature this model gives (158 K at 1 au) would make H/R = 0.025 there (c_s / v_K, mu = 2.34),
  // so the disk is drawn about 1.8 times thicker than its own temperature would hold up. The surface density is kept, so
  // the midplane density falls by 1.5 and with it the grazing optical depth toward the star: LNTAU1 8.5 -> 8.5 - ln 1.5.
  // The density at the irradiation surface (RHO_B, where the wind is based) does not change: it is set by tau* = 1.)
  const MODEL = { R_IN: 0.08, H0: 0.045, R_OUT: 30.0, P_OUT: 6.0, LNTAU1: +(8.5 - Math.log(1.5)).toFixed(4), TICE: 160.0, K_D: 1200.0, SD0: 0.012 };
  // (Disk Lab v2, round 8, the owner: "the pebbles' disk 1/1.5 of the gas's radius") The pebbles end at R_PEB = R_OUT / 1.5
  // = 20 au, in a cutoff of the same shape as the gas's, exp(-(R/R_PEB)^P_OUT): millimetre dust disks are smaller than
  // their gas disks (Ansdell et al. 2018, Lupus: R_CO / R_mm of 1.5 to 3; the lower optical depth of the dust at its edge
  // alone gives 1.5 to 3.5, more needs radial drift: Trapman et al. 2019). A planet's ring at a pressure maximum beyond the pebbles' edge has nothing to hold: the
  // ring is the pebbles' surface density there, so it fades with them (a planet at 15 au rings at a third of the
  // brightness it would have, one at 20 au hardly at all).
  MODEL.R_PEB = MODEL.R_OUT / 1.5;
  // The temperature (Disk Lab v2, round 7, the owner: "the temperature on the cut is made up: do it properly"). Until round
  // 6 it was the midplane's T = 160 K (0.9 au / R)^1/2, a power law, rising toward the irradiation surface as cos^4 to 2.8
  // times that (Dartois et al. 2003's form, a choice). Now it is built from the model's own geometry and the papers on
  // exactly this (DESIGN.md, section 17, gives the equations, the numbers and the sources read):
  //   the interior lit by the reprocessed starlight, T_i^4 = beta L / (16 pi sigma R^2): the interior of Chiang & Goldreich
  //     (1997, eq. 12a, (alpha/4) (R*/a)^2 T*^4), with the grazing angle beta of this model's own irradiation surface
  //     (z_s = H sqrt(2 ln tau*_mid), as Eabs);
  //   accretion where the disk is laminar (the dead zone, and beyond it): T_acc^4 = (3 Mdot Omega^2 / 32 pi sigma)
  //     (tau_heat + 1/sqrt 3), Mori, Okuzumi, Kunitomo & Bai (2021, eq. 8). The accretion energy is released by Joule
  //     dissipation in the current layer high up (several H in Mori, Bai & Okuzumi 2019; 2-3 H in Mori, Bai & Tomida 2025,
  //     who find it does not change the disk's temperature), with only tau_heat of 1-3 above it, so it barely warms the
  //     midplane: flat below the layer (the accretion layer of ACC here), falling above it with the column (eq. A1);
  //   accretion where the disk is turbulent (thermally ionized, inside R_TI): heat released where the gas is, so that the
  //     midplane is blanketed, T_vis^4 ≈ 3 kappa_R Mdot^2 Omega^3 / (128 pi^2 sigma alpha c_s^2) (ibid., eq. 14), falling
  //     with height as the effective optical depth, tau_mid (2u - u^2) / 2 with u the share of the column above (eq. A8);
  //   T_int^4 = T_i^4 + (1 - m) T_acc^4 + m T_vis^4 + T_FLOOR^4, m the turbulent share (mriAmp): the contributions add
  //     in T^4 (Mori et al. 2019, eq. 10, linear in the heating; eq. 6 and 13 of 2021); T_FLOOR, 10 K, for the
  //     interstellar field where the disk's edge is in its own shadow;
  //   above it, the grains in the starlight that reaches them, attenuated by tau* (this model's own, the irradiation
  //     surface at tau* = 1), are superheated: with an emission efficiency ∝ T (Chiang & Goldreich 1997, eq. 11, beta = 1)
  //     their radiative balance gives T^5 = T_int^5 + T_ds^5 e^-tau*, T_ds = (L T* / 16 pi sigma R^2)^1/5;
  //   dust cannot be hotter than its sublimation, about T_SUB = 1500 K: where the turbulent inner disk would heat it
  //     beyond, the grains, and with them the opacity, go, so the temperature is held near it (a soft cap).
  // R_TI, the edge of the thermally ionized inner disk, is where T_vis reaches T_TI = 1000 K (the alkali metals ionize):
  // 0.30 au with these values (it was set there for this reason; the colours used to show 280 K there). Parameters, the
  // owner's to check: L = 2.7 L_sun, as in Mori, Bai & Tomida 2025 (a young solar-mass star; their midplane is 156-180 K
  // at 1 au); T* = 4300 K, the starlight's colour for the grains; Mdot = 1.5e-8 M_sun/yr (with R_TI at 0.3 au; 1e-8 puts it
  // at 0.25 au); kappa_R = 5 cm^2/g (0.1 micron grains, Mori et al. 2019, 2021); alpha = 1e-2 where turbulent (the viscous
  // comparison of Mori et al. 2021); tau_heat = 2 (their Sigma_heat of 0.2-0.6 g cm^-2). With these the midplane is 158 K
  // at 1 au, the snow line (160 K) at 0.98 au, and 1000 K at 0.27 au (round 7, with H0 = 0.03: 147 K and 0.86 au). KI, KDS5, KM, KV: the laws' factors at 1 au (cgs).
  const THERMO = (() => {
    const L = 2.7, T_STAR = 4300, MDOT = 1.5e-8, KAPPA_R = 5, ALPHA = 1e-2, TAU_HEAT = 2, T_TI = 1000, T_SUB = 1500, T_FLOOR = 10;
    const sig = 5.6704e-5, au = 1.496e13, Lsun = 3.828e33, Msun = 1.989e33, yr = 3.156e7, Gc = 6.674e-8, k = 1.3807e-16, mH = 1.6726e-24, mu = 2.34;
    const Md = MDOT * Msun / yr, Om1 = Math.sqrt(Gc * Msun / (au * au * au));
    const KI = L * Lsun / (16 * Math.PI * sig * au * au);                                     // T_i^4 = KI beta / R^2
    const KDS5 = KI * T_STAR;                                                                   // T_ds^5 = KDS5 / R^2
    const KM = 3 * Md * Om1 * Om1 / (32 * Math.PI * sig) * (TAU_HEAT + 1 / Math.sqrt(3));      // T_acc^4 = KM / R^3
    const KV = Math.pow(3 * KAPPA_R * Md * Md * Om1 * Om1 * Om1 * mu * mH / (128 * Math.PI * Math.PI * sig * ALPHA * k), 0.2);   // T_vis = KV R^-0.9
    return { L, T_STAR, MDOT, KAPPA_R, ALPHA, TAU_HEAT, T_TI, T_SUB, T_FLOOR, KI, KDS5, KM, KV, R_TI: Math.pow(KV / T_TI, 10 / 9) };
  })();
  const G = (v) => Number.isInteger(v) ? v.toFixed(1) : String(v);   // a JS number as a GLSL float literal
  // The marched region: a cylinder past the disk's edge (RB) and up to the top of the drawn wind (ZB), in au. The disk was
  // 8 au in radius until the seventh round, 30 au since; the outer parts of the picture that scale with it (the wind's and
  // the envelope's softened falloffs with distance, the zoom range, the views) were scaled by about 3.75 with it.
  // (Disk Lab v2, round 8, the owner: "about 1.7 times more of the wind's region". 40 x 30 au -> 68 x 51 au, and with it
  // what scales the wind's extent: its fade toward the cylinder's top and side (0.55 to 1 of each), the wind map's reach
  // (to 120 au from the star), the softened falloff of the starlight that lights it (1 / (1 + (r / 15 au)^2) -> 1 / (1 +
  // (r / 15 au)^WIND_SOFT), 1.5: as before within about 15 au, twice as bright at 60 au; the observed looks keep the old), the field
  // lines' height and outer fade. The self-similar solution goes on as it is: the lines from the outer disk reach a height
  // of 51 au at chi of about 2, well within the table. The observed looks keep the cylinder they had (RB_OBS, ZB_OBS),
  // with the wind's fade of before toward its edges: their marches are the heaviest (the CO line's, and the continuum's
  // fine steps took 29 % longer in the larger cylinder), their wind is faint, and the CO line's emission lies within it.)
  const RB_JS = 68, ZB_JS = 51, RB_OBS = 40, ZB_OBS = 30, WIND_SOFT = 1.5;
  // Non-ideal MHD: the gas is so weakly ionized that the field slips through it. Two of the effects set where it couples
  // (Mori, Bai & Tomida 2025, and the papers it builds on):
  //   Ohmic diffusion dominates at high density, near the midplane. Its diffusivity is a Gaussian in height,
  //     eta_O = eta0(R) exp(-z^2 / 2 sigma^2) with sigma = H (eta ∝ 1/x_e, and the ionization fraction falls toward
  //     the midplane as the density rises and the X-rays and cosmic rays that ionize the gas are absorbed). Where it
  //     exceeds the critical value at which the Ohmic Elsasser number v_A^2 / (eta_O Omega) is 1, the field does not
  //     couple: no currents flow, the field is vertical, and no turbulence can grow there. That is the dead zone,
  //     |z| < z_k(R) = sigma sqrt(2 ln(eta0 / eta_c)). eta0 / eta_c = (R_DZ / R)^Q falls outward (a lower midplane
  //     density, more of the ionizing radiation reaching it), with the disk's edge cutting it further, so the dead
  //     zone thins outward and ends at 7.5 au: z_k = 3.1 H at 0.35 au, 2.5 H at 1 au, 1.7 H at 3 au, 0.8 H at 6 au.
  //     (Beyond it the column is thin enough, below about 100 g cm^-2 for the minimum-mass nebula, for cosmic rays to
  //     reach the midplane, so the whole column couples. Ambipolar diffusion keeps the instability weak there: Disk Lab
  //     v2 lets it stir the outer disk a little, rising from 7.5 au to its full, small strength at 14 au (OUTER_TURB,
  //     a seventh of the inner disk's; simulations with ambipolar diffusion find alpha of 1e-4 to 1e-3 there, Bai &
  //     Stone 2011, Simon et al. 2013, and the outer disks observed in CO show turbulence of a few per cent of the sound
  //     speed at most, Flaherty et al. 2015, 2017); out to 7.5 au the disk is laminar, as before.)
  //     For a surface density of 1700 g cm^-2 at 1 au (the minimum-mass solar nebula), 2.5 H leaves about 10 g cm^-2
  //     above it, the depth to which the star's X-rays ionize the gas (Igea & Glassgold 1999). Inside R_TI = 0.3 au the disk is
  //     hot enough (above about 1000 K) for alkali metals to be thermally ionized, so the whole column couples. (Round 7:
  //     R_TI is where the turbulent disk's own accretion heating reaches 1000 K, see THERMO, and the colours show it; until
  //     round 6 they showed the starlight's heating only, 280 K there.)
  //   Ambipolar diffusion dominates at low density, in the surface layers: the ambipolar Elsasser number Am is of order
  //     one there, so the field couples (currents flow, the field bends, and the wind's torque drives accretion) but
  //     the magnetorotational instability is suppressed: the surface is laminar. Above the irradiation surface the
  //     star's far-ultraviolet light ionizes the gas (Am >> 1) and the wind is launched.
  // So the disk is laminar everywhere except inside R_TI, where the magnetorotational instability stirs the whole
  // column (and, weakly, beyond about 10 au); across the dead zone the field lines are vertical up to z_k and bend there into the wind (see fieldRP and
  // tools/bp-wind/kink.py, which solves the steady induction equation in height to check the shape: the bend is
  // concentrated within about BEND = 0.6 H above z_k, and the current there drives the accretion).
  const NONIDEAL = { R_TI: +THERMO.R_TI.toFixed(3), R_DZ: 7.5, Q: 1.55, BEND: 0.6, TI: 12, OUTER: 0.3, DZ: 0.12, R_OT: [7.5, 14] };
  // (Round 8, item 27, added a pressure maximum at the dead zone's outer edge, 7.5 au, the gas dipping 0.3 and rising 0.3
  // and the pebbles a ring of 3 times at 8.95 au (DZB, after Flock et al. 2015, whose edge lies at 20-60 au). Round 9, the
  // owner: "remove the ring at 9 au": gone, the gas's dip and bump with it. The pile-up just outside the snow line stays.)
  // (Round 8, the owner: "the disk looks flat" and "fine patterns carried round by the rotation") The density's small
  // fluctuations everywhere, in proportion to the stirring: OUTER and DZ are the outer disk's and the dead zone's relative to
  // the thermally ionized inner disk's (1). The ratios read (DESIGN.md, section 21): delta rho / rho about 0.1 where the
  // magnetorotational instability works (Flock et al. 2011, 2017; Okuzumi & Hirose 2011), 0.011-0.013 in an Ohmic dead
  // zone stirred by the active layers' waves (Okuzumi & Hirose 2011; Fleming & Stone 2003; Oishi & Mac Low 2009: waves, no
  // eddies), and motions of 0.01-0.1 of the sound speed measured in outer disks (Flaherty et al. 2015-2020; DM Tau 0.25-0.33):
  // 1 : 0.1-0.15 : 0.1-0.5, here 1 : 0.12 : 0.3 (0.15 before round 8, and none in the dead zone). The pattern is the one
  // the inner disk had, carried round at the Keplerian rate (on the model's clock) and sheared, so the faster inner disk shows.
  // The surface accretion: the wind's torque acts where the field bends, so the gas there loses angular momentum and
  // flows inward in a thin current layer just above the dead zone's top, laminar, while turning with the disk (the
  // steady induction equation in height, tools/bp-wind/kink.py, puts the current and the inflow there: about 2 c_s at
  // its peak for a symmetric field, the B_phi jump of each side carried by each side's layer). With the field aligned
  // with the rotation the current layer is pushed to one side (the Hall effect), so the whole jump and the accretion are
  // there, and the wind on that side fails (Mori, Bai & Tomida 2025: about 10% of the Keplerian speed, up to 30% at the
  // peak; clumps form and accrete repeatedly). Here: a layer centred OFF H above z_k, a Gaussian W H wide (sigma), its
  // inflow K c_s, K_SYM on each side for a symmetric wind and K_ASYM on the lower side with the asymmetry (4 c_s is
  // about 0.12 v_K at 1 au). In the model's look it is drawn with a column SIG of the local surface density, in streaks
  // (see accTurb), glowing amber (ACC_COL: where the current dissipates, Joule heating; a colour to tell it apart). With
  // a column in proportion to Σ the inflow carries nearly the same mass flux at every radius (2πR Σ_A k c_s ∝ R^-1/4),
  // as steady accretion would; but SIG is a choice for the picture: 1e-8 solar masses a year at 4 c_s needs only about
  // 2e-5 of Σ at 1 au (for the minimum-mass nebula), which would not show.
  // (Disk Lab v2, rounds 8, the owner: "you have laminar wrong: laminar means not turbulent; above the accretion layer the
  // disk wind should blow", and "the accretion layer is where the field bends; in the outer disk it lies near the
  // midplane". The regions were named on two axes at once: a "laminar surface" between the accretion layer and the wind's
  // base, though the dead zone, the accretion layer and the wind are all laminar. Read again (DESIGN.md, section 21): the
  // current layer, where B_phi reverses and the field bends, sits directly on the dead zone's top (3.0 H at 1 au: Bai &
  // Stone 2013; Bai 2013, table 2; 2-3 H in Mori, Bai & Tomida 2025), comes down outward with the dead zone and reaches the
  // midplane where there is none (beyond 4-10 au: Bai 2013; Bai 2017, sec. 4.2.1; Wang, Bai & Goodman 2019); above it the
  // field opens and the gas is slowly lifted (ambipolar diffusion dominates, a weak outward flow: the wind-launching region,
  // Wang, Bai & Goodman 2019, sec. 4.1.4, 4.2.2), and the wind's base proper, where the flow becomes a wind, is the FUV
  // front, about 4-5 H (Bai & Stone 2013, table 2; Gressel et al. 2015), the irradiation surface here. With the field
  // aligned with the rotation (the Hall effect) the current layer is pushed to one side's surface, near its FUV front
  // (Bai 2017, sec. 5; Mori, Bai & Tomida 2025, sec. 3.2.1, fig. 7), and the wind on that side fails.) So: the layer's centre
  // is zAcc, the middle of the field's bend (OFF = BEND / 2 above the dead zone's top), down to the midplane where the dead
  // zone ends; there is a layer wherever the disk is not turbulent; with the asymmetry the lower side's layer and its bend rise
  // toward its wind base. OFF was 0.15 H, and the layer ended with the dead zone (accAmp, by 6 au).
  const ACC = { K_SYM: 2, K_ASYM: 4, W: 0.3, OFF: 0.3, SIG: 0.02, R_END: 0.4, C_SYM: 0.6, C_ASYM: 1.6 };
  // The star's magnetosphere (round 7), drawn close up only (it fades in as the camera comes within SHOW au of the star,
  // and costs nothing from farther). A T Tauri star of one solar mass and radius RS = 2 R_sun = 0.0093 au with a dipole
  // field of about 1 kG at its surface truncates the gas disk where the field's pressure balances the inflow's ram
  // pressure, r_T = xi (mu^4 / (2 G M Mdot^2))^(1/7) with mu = B RS^3: 0.060 au for xi = 1 and 1e-8 solar masses a year,
  // RT = 0.05 au for xi = 0.83 (xi about 0.5 to 1; Koenigl 1991; Bouvier et al. 2007). The star turns in P_DAYS = 8 days,
  // typical of classical T Tauri stars (Herbst et al. 2007), so its corotation radius, (G M P^2 / 4 pi^2)^(1/3) = 0.078
  // au, lies outside RT (RT / r_co = 0.64: the disk's edge turns faster than the star, and the gas accretes) and at the
  // dust's sublimation radius R_IN: between RT and the dust's edge the gas disk has no dust. The dipole is tilted by TILT and turns with the star (it is drawn in the star's frame): the gas leaves
  // the disk's inner edge along the closed lines L = RT to RT (1 + DL) (L = r / sin^2 theta about the dipole's axis) and
  // falls freely onto the star, at 400 km/s at its surface, toward the north magnetic pole on the side the dipole tilts to
  // (where the disk lies above the magnetic equator) and toward the south one on the other: two broad funnels, as in the
  // simulations of tilted dipoles (Romanova et al. 2003, 2004). It lands at sin^2 theta = RS / L, about 25 degrees from
  // the poles, in hot spots. Close to the star the model's clock slows (see clockK): an orbit at RT takes 0.13 s of it.
  const MAG = { RS: 0.0093, RT: 0.05, TILT: 10 * Math.PI / 180, P_DAYS: 8, DL: 0.3, SHOW: 2, DMIN: 0.04 };
  MAG.SPIN = 2 * Math.PI / (12 * MAG.P_DAYS / 365.25);   // rad per second of the model's clock (a year at 1 au is 12 s)
  // A planet of Jupiter's mass (mass ratio q = 1e-3) on a circular orbit at 3 au, beyond the snow line. Its Hill radius
  // is a (q/3)^1/3 = 0.21 au. It opens a gap in the gas with the profile of Kanagawa et al. (2017) for alpha = GAP_ALPHA
  // (see gapK; round 6): at 3 au (H/R = 0.04) Σ_min/Σ_0 = 0.0024, the floor from 2.5 to 3.5 au, the walls out to 1.0 and
  // 5.0 au (half depth at 1.8 and 4.2 au, a width of 0.82 a). (Before round 6 a Gaussian of width (sigma) 1.8 Hill radii,
  // 0.3 deep from afar and 0.98 close up, a choice for the picture.) Everything that follows from the gap takes the
  // same depth: the starlight on it, the pebbles (filtered out of the gap, and collected at the pressure maximum just
  // outside it once the gap is deep enough to make one, see trapOf), the wind launched from it, the wake and the slice.
  // The wake, the spiral density wave the planet launches, follows Rafikov (2002) in shape; its amplitude is the
  // physical one (WAKE_P at WAKE_X0 from the orbit, decaying away from it), or exaggerated on demand (WAKE_A, WAKE_L:
  // the waves' emphasis, opt.waves; see wake in the disk map), and drawn weaker from afar (DEPTH.WAKE_FAR). Close up,
  // the planet and its circumplanetary disk (out to 0.4 Hill radii) show.
  const PLANET = (() => {
    const A = 3.0, Q = 9.546e-4, RH = A * Math.cbrt(Q / 3);   // (round 8: Q is Jupiter's mass ratio, 9.546e-4; 1e-3 before)
    return { A, Q, RH, HP: MODEL.H0 * Math.pow(A, 0.25), PHI0: 2.4, WAKE_A: 6.0, WAKE_L: 0.6, WAKE_P: 1, WAKE_X0: 0.1, WAKE_NI: 0.82, WAKE_NO: 0.69 };
  })();
  // (Disk Lab v2) Several planets: up to MAX, each a Jupiter as above on its own orbit of radius a (au), within RANGE,
  // neighbours at least SPACING apart in the ratio of their radii. Everything above scales with a: the Hill radius
  // RH = a (Q/3)^1/3, the planet's own disk 0.4 RH, h_p = H0 a^1/4; the gap's profile is gapK(a)'s (its width relative to
  // a goes as h_p^-3/4, a^-3/16) and the starlight on it is traced for each a (see gapLight). RANGE: 1 to 20 au (with the
  // profile of round 6 a planet at 1 au clears 0.2 to 1.8 au, beyond the formula's tested h of 1/30 to 2/15 a little, and
  // one at 20 au reaches the disk's tapered edge with its outer wall: kept, and said so in the notes). SPACING 1.4: two
  // Jupiters closer than about 3.5 mutual Hill radii (a ratio of 1.3) are not stable (Gladman 1993); at 1.4 their gaps
  // join into a common one, as in simulations of pairs of giant planets. PHI0: the planets' azimuths at time 0, a golden
  // angle apart.
// (Round 7, the owner: "let planets be placed close to the star". RANGE starts at the magnetosphere's truncation radius
// MAG.RT, 0.05 au, the inner edge of the gas disk: inside it there is no disk gas for a planet to open a gap in or raise
// waves in, and a planet migrating in the disk stops near that edge (the cavity proposed for 51 Peg b by Lin, Bodenheimer
// & Richardson 1996; the hot Jupiters pile up at periods of about 3 days, 0.04 au). From 0.05 to 0.08 au the planet orbits
// in the dust-free gas (its gap shows there, in magGasDisk), and its pebble ring, at the outer wall, in the dusty disk.
// Below about 1 au h_p is under the 1/30 for which Kanagawa et al. tested the gap's profile: it is extrapolated, and with
// alpha = 1e-3 the inner wall of a Jupiter's gap reaches the disk's inner edge (the planet clears the disk inside it).)
  const PLANETS = { MAX: 4, RANGE: [MAG.RT, 20], PHI0: (i) => PLANET.PHI0 + 2.39996 * i };   // (round 8: SPACING, 1.4, gave way to MASS.K_HILL)
  // (Disk Lab v2, round 8, the owner: "give the planets a mass slider") Each planet has its mass m (in Jupiter masses, M_J =
  // 9.546e-4 of the Sun's) within MASS (10 Earth masses to 3 M_J), q = m M_J / M_sun, and everything that depends on q
  // follows it through the same formulas: the gap's depth and width (Kanagawa et al. 2017, K ∝ q^2), the Hill radius and with
  // it the planet's own disk (0.4 R_H), the wake's amplitude (its linear part grows as q / h_p^3, the planet's mass in
  // thermal masses, up to 1; Jupiter at 3 au is 4.6 of them), the glow of the planet and its disk (as (m / M_J)^1/2 from 0.25
  // to 1.8, a display choice), and the pebbles' ring, which needs a pressure maximum outside the gap: only planets above the
  // pebble isolation mass make one (Lambrechts et al. 2014; Bitsch et al. 2018, eqs. 10-11 for alpha = 1e-3: M_iso = 25
  // M_earth (h_p / 0.05)^3 (1 - (d ln P / d ln R + 2.5) / 6), with d ln P / d ln R = -2.75 - 6 (R / R_OUT)^6 here: 43
  // M_earth at 3 au, 107 at 10 au, 195 at 20 au), the ring rising from 0.7 to 1.3 M_iso (just below it the pebbles only
  // slow, a traffic jam rather than a trap: Rosotti et al. 2016). The upper end, 3 M_J: above it the gap turns eccentric for
  // alpha <= 1e-3 (Kley & Dirksen 2006; Zhang et al. 2018), which the axisymmetric profile cannot show; Kanagawa et al.
  // tested 5e-5 < q < 2e-3 (17 M_earth to 2.1 M_J), so the ends are extrapolated a little. The lower end, 10 Earth masses,
  // opens hardly any gap. Neighbours are kept at least K_HILL mutual Hill radii apart, ((m1 + m2) M_J / 3)^1/3 (a1 + a2) / 2
  // (round 8; a radius ratio of 1.4 until then, which is 3.9 mutual Hill radii for two Jupiters): two planets on circular
  // orbits are Hill stable beyond 2 sqrt 3 = 3.46 (Gladman 1993, as given by Pu & Wu 2015 and Obertas et al. 2017); 4 keeps
  // two Jupiters at the ratio of before, 1.42; systems of several planets need more to last a Gyr (about 10, Pu & Wu 2015),
  // which a disk's few Myr do not ask.
  const MASS = { MJ: PLANET.Q, ME: 3.003e-6, MIN: 10 * 3.003e-6 / PLANET.Q, MAX: 3, K_HILL: 4 };
  const qOfM = (m) => m * MASS.MJ;
  // the smallest ratio of radii between neighbours of masses m1 and m2 (M_J)
  const minRatio = (m1, m2) => { const x = 0.5 * MASS.K_HILL * Math.cbrt((qOfM(m1) + qOfM(m2)) / 3); return x < 0.9 ? (1 + x) / (1 - x) : 19; };
  // the pebble isolation mass at a (in units of q)
  const isoQ = (a) => 25 * MASS.ME * Math.pow(MODEL.H0 * Math.pow(a, 0.25) / 0.05, 3) * (1 + (0.25 + 6 * Math.pow(a / MODEL.R_OUT, MODEL.P_OUT)) / 6);
  const GT_N = 2048;   // radii of the gaps' table (see gapT)
  // the wake's strength: WAKE_FAR of its amplitude when the camera is beyond D1 au from the planet's orbit (the circle
  // R = a in the midplane; the usual view is at 23 au), all of it within D0, eased in between, so that from the usual view
  // its arms do not stand out as rings (made for the exaggerated amplitude, and kept with the physical one): a choice for
  // the picture. The distance to the orbit rather than to the planet, so that it does not change as the planet goes round.
  // (Until round 6 the gap's depth followed the same function, 0.3 afar to 0.98 close up; it is the profile's now.)
  const DEPTH = { D0: 4, D1: 18, WAKE_FAR: 0.2 };
  const GL_R0 = 0.9, GL_DR = 8.7 / 127;   // radii of the table of starlight on the gap, in units of a / A_REF (see gapLight)
  const WIND_LOW_JS = 0.1;                // the weaker side of the wind relative to the stronger, with the asymmetry (see uWindLow)
  const ASYM_F_JS = 0.5;                  // the dead zone's horizontal field with the asymmetry, as a share of the wind's (see bendQ)
  // The pebbles' excess at the pressure maximum outside a gap, at the trap's full strength (t.s): the ring's surface density
  // there is 1 + PEB_RING s times the smooth disk's. (Round 8, the owner: "weaken the pebbles' pile-up at the gap's outer
  // edge just a little": 2.2 -> 1.65, a quarter less, so that in the millimetre look the ring does not outshine the gap's
  // dark lane. A display choice: the true excess depends on the pebbles' size and the trap's age.)
  const PEB_RING = 1.65;
  // (Disk Lab v2, round 8, the owner: "I'd like a jet too") The jet: a narrow, fast, bipolar flow along the axis, launched
  // from the disk's inner edge near the star (the X-region at 0.05 au, or the inner disk within about 0.1 au: Frank et al.
  // 2014, sec. 2.1; Ray & Ferreira 2021), where the model's tube along the axis had no gas. The numbers read (DESIGN.md,
  // section 21): T Tauri jets move at a few hundred km/s (Frank et al. 2014; Ray & Ferreira 2021; DG Tau's fast component
  // about 300 km/s, Agra-Amboage et al. 2011; HH 30's knots 116-225 km/s, Hartigan & Morse 2007): V = 250 km/s. Narrow: a
  // full width at half maximum of 14 au at 20 au and 36 au at 500 au for HH 30 (Hartigan & Morse 2007), 20-40 au at 100 au
  // (Ray et al. 2007), widening as about the square root of the height close in and then at a few degrees: r(z) = (RL^2 +
  // A z)^1/2 out to Z1, then a cone of half-angle CONE (r the half width at half maximum; 7.7 au full width at 10 au, 25 at
  // 100 au, 48 at 500 au); below about 9 au held within a cone from its foot, RL + BASE z (see jetR). Knots: internal shocks of a launch speed that varies, new knots forming 50-100 au out every 2.5
  // to 5 years (Frank et al. 2014, sec. 3.3; DG Tau every ~2.5 yr, Agra-Amboage et al. 2011), and finer ones (HH 212's
  // 30 au spacing, Lee 2020): two periods, P1 = 2.5 yr (132 au apart at V) and P2 = 0.6 yr (32 au), the knots moving out at
  // V on the model's clock (so they slow as the clock does, zoomed in). Bipolar: by default symmetric; with the wind's
  // asymmetry the lower lobe is 1.5 times slower and as much denser (the same mass flux), as the two lobes of RW Aur or DG
  // Tau (speed ratios 1.4-2.6 in half the jets, Podio et al. 2021 citing Hirth et al. 1994). Its light is a display choice:
  // emission per unit volume in proportion to its density (n ∝ 1 / r^2 at a fixed mass flux), so that its surface brightness
  // falls as 1 / r, times the knots. Seen in the model look in its material's colour; in the visible look as the red of its
  // forbidden lines and H-alpha, faintly (its continuum is negligible); not in the mid-infrared, millimetre or CO looks
  // (Class II jets are atomic; their dust is depleted and its emission negligible: Frank et al. 2014, Lee 2020).
  // (Round 8, the owner: "on or off by the resolution") The finish of items 26 and 29 by the page's quality (opt.fx, data-fx,
  // diskSet({ fx })): 0 (Low) none of it; 1 (Medium) the star's light in the model's look (26), the tone curve and the
  // depth's haze (29); 2 (High, Best, and the still pictures) also the glow of the bright parts (29). It fades in and out
  // over 0.4 s. Not the structures of items 27 and 28, which are the model's, nor the observed looks.
  // (Round 9, the owner: "collimate the jet much more; yellow, say; it can be discreet") The width above, from the widths
  // measured at 10 to 500 au, made it 21 degrees wide (half angle) at 10 au and 7 at 100 au. Now a narrow cone: its half
  // width at half maximum RL + BASE z from its foot (8.5 degrees) until it meets RC + tan(CONE) z, a cone of 2 degrees
  // (at 1.6 au, 0.3 au wide): 0.6 au at 10 au, 3.7 au at 100 au, 18 au at 500 au. Narrower than the jets measured (HH 30's
  // 14 au full width at 20 au, here 1.9 au): a choice of the picture, the owner's. Its light dimmer (G_JET) and in pale
  // yellow (MAT: jet) in the model's look; in the visible look still the red of its lines.
  const JET = { V: 250 * 0.21095 / 12, RL: 0.07, BASE: 0.15, RC: 0.25, CONE: 2.0 * Math.PI / 180, Z0: 0.05, ZMAX: 520, P1: 2.5 * 12, P2: 0.6 * 12, K1: 3.0, K2: 1.2, LOW: 1.5,
    LOOK: { model: 1, optical: 0.3, mir: 0, mm: 0, co: 0 } };
  const PUFF = { P: 2 };                  // the wind's puffs: a bundle's launch period (s of the model's clock; see puffFactor)
  // The envelope: the parent cloud, in solid-body rotation, collapses onto the star and the disk (Ulrich 1976). Each
  // parcel falls from rest far away on a parabolic orbit (zero energy) that keeps its angular momentum, sqrt(G M r_c)
  // sin(theta0) with theta0 its starting polar angle (z-component sqrt(G M r_c) sin^2 theta0), so it lands on the
  // midplane at r_c sin^2 theta0, inside the centrifugal radius r_c, here the edge of the disk (30 au):
  //   streamline  r = r_c sin^2 th0 / (1 - cos th / cos th0), with cos^3 th0 + cos th0 (r/r_c - 1) - (r/r_c) cos th = 0
  //   velocity    v_r = -sqrt(GM/r) (1 + cos th/cos th0)^1/2, v_th = sqrt(GM/r) (cos th0 - cos th) ((cos th0 + cos th) /
  //               (cos th0 sin^2 th))^1/2, v_phi = sqrt(GM/r) (sin th0/sin th) (1 - cos th/cos th0)^1/2
  //   density     rho = Mdot / (4 pi sqrt(G M r^3)) (1 + cos th/cos th0)^-1/2 (cos th/cos th0 + 2 cos^2 th0 r_c/r)^-1
  // (checked numerically: the velocities have zero energy and the parcel's angular momentum, are tangent to the
  // streamlines, and div(rho v) = 0; the mass flux is Mdot through every sphere outside r_c, and Mdot (1 - sqrt(1 - r/r_c))
  // inside it, where the streamlines that started nearer the midplane have already landed on the disk; see
  // tools/bp-wind/ulrich.py). The outflow (the disk wind) clears a cavity along the axis: the streamlines that start within
  // TH_CAV = 30 degrees of it are emptied (the cavity's wall is itself a streamline, which reaches the disk at
  // r_c sin^2 30 deg = 7.5 au). The cavity's cone, the streamers (see ENV3_FS) and the density's scale for the display
  // (ENV_RHO) are choices for the picture. The envelope is drawn out to R = 560 au, when the camera is farther than about
  // 150 au; beyond that radius (the collapse front, in the inside-out collapse of Shu 1977 at some hundreds of au, outside
  // which the cloud is static, rho ∝ r^-2) the cloud is not modelled. Its particles start at 225 au and move SPEED times
  // faster than the disk's clock (the fall from 225 au to the disk takes some 600 of the disk's years). r_c was 8 au until
  // the seventh round, 30 au since, with the disk; the distances above scaled with it.
  // (Disk Lab v2, round 6: r_c is the disk's outer radius by definition, ENV.RC = MODEL.R_OUT, one constant for both:
  // the owner, "Ulrich の rc は円盤外縁にセットして". Everything of the envelope that depends on r_c takes it from here.)
  const ENV = { R: 560, TH_CAV: Math.PI / 6, SPEED: 220, NS: 18, RC: MODEL.R_OUT };
  // (Disk Lab v2, round 8, the owner: "in the model look, don't colour by temperature: give each material a good-looking
  // colour; looks first") The model's look colours every material by what it is: hue says which material, brightness how
  // much of it is there (as before). The temperature stays where it is a quantity: the cut's Temperature, and the observed
  // looks (their thermal light). Each entry: the key used in the shader (MAT_<KEY>), the colour as seen (sRGB), a brightness
  // factor on the glow the material had (chosen by eye, so that the disk keeps about the brightness it had in the colours of
  // its temperature), and the names in the page's key. Tried by eye (DESIGN.md, section 21): the large dim structures in
  // deep, saturated hues that stay coloured when faint and blend without going grey where they overlap (the disk royal
  // blue, the wind cyan, the envelope orchid; an apricot disk under a blue wind turned muddy grey, and a faint orange reads
  // brown), and warm accents for what lies in the disk or comes from it (the amber accretion layer, brown rock and pale
  // blue ice, gold planets, the coral jet); the star's own violet magnetosphere and magenta curtains. The star keeps its
  // warm white (STARCOL).
  const MAT = [
    ['disk', '#2a55ff', 0.6, '円盤(ガスと塵)', 'disk (gas and dust)'],
    ['acc', '#ffa52e', 1.0, '降着層', 'accretion layer'],
    ['rock', '#a0623c', 1.0, '小石(岩)', 'pebbles (rock)'],
    ['ice', '#9fd4ff', 0.8, '小石(氷)', 'pebbles (ice)'],
    ['wind', '#4fe0ff', 1.0, '円盤風', 'disk wind'],
    ['jet', '#f4e87a', 1.0, 'ジェット', 'jet'],   // (round 9: pale yellow, the coral before; see JET)
    ['env', '#b47fe0', 1.0, 'エンベロープ', 'envelope'],
    ['mag', '#9070ff', 1.0, '磁気圏', 'magnetosphere'],
    ['curt', '#ff4fc8', 1.0, '降着の柱', 'accretion curtains'],
    ['planet', '#ffd040', 1.0, '惑星と周惑星円盤', 'planets and their disks']
  ];
  const linHex = (h) => [1, 3, 5].map((i) => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));
  const BP = {
    C0: 0.25, SMAX: 5.484797, CHIMAX: 60.0, A0: 2.0570, B0: -3.9977,   // table grid; dR/dz and B_phi/B_z at the surface
    XI: [1, 1.0459, 1.094, 1.1445, 1.1974, 1.253, 1.3114, 1.3727, 1.4372, 1.5049, 1.5762, 1.6512, 1.73, 1.813, 1.9003, 1.9921, 2.0887, 2.1904, 2.2973, 2.4097, 2.5279, 2.6521, 2.7827, 2.9198, 3.0638, 3.215, 3.3736, 3.5398, 3.714, 3.8963, 4.0871, 4.2865, 4.4948, 4.712, 4.9383, 5.1739, 5.4186, 5.6726, 5.9356, 6.2076, 6.4881, 6.7769, 7.0733, 7.3768, 7.6864, 8.0012, 8.3199, 8.6411, 8.963, 9.2838, 9.601, 9.9122, 10.214, 10.505, 10.779, 11.034, 11.265, 11.469, 11.64, 11.775, 11.869, 11.919, 11.919, 11.868],
    PHI: [0.0039947, -0.084394, -0.17558, -0.26978, -0.36721, -0.4681, -0.57269, -0.68123, -0.79399, -0.91124, -1.0333, -1.1604, -1.293, -1.4314, -1.576, -1.7271, -1.8852, -2.0508, -2.2244, -2.4065, -2.5976, -2.7984, -3.0095, -3.2316, -3.4656, -3.7122, -3.9722, -4.2468, -4.5368, -4.8434, -5.1677, -5.5112, -5.8752, -6.2612, -6.6709, -7.106, -7.5685, -8.0605, -8.5843, -9.1424, -9.7374, -10.372, -11.05, -11.775, -12.55, -13.38, -14.268, -15.221, -16.242, -17.34, -18.518, -19.786, -21.149, -22.618, -24.2, -25.907, -27.748, -29.737, -31.887, -34.211, -36.727, -39.45, -42.4, -45.597],
    TAU: [-4.0518, 0.1778, 1.2026, 1.8367, 2.3168, 2.712, 3.0559, 3.3658, 3.6529, 3.923, 4.1815, 4.4316, 4.6761, 4.9172, 5.1565, 5.3957, 5.6359, 5.8785, 6.1245, 6.3749, 6.6307, 6.8929, 7.1625, 7.4404, 7.7276, 8.0253, 8.3344, 8.6561, 8.9916, 9.342, 9.7088, 10.093, 10.497, 10.922, 11.369, 11.841, 12.34, 12.867, 13.425, 14.017, 14.645, 15.313, 16.024, 16.781, 17.588, 18.449, 19.37, 20.354, 21.408, 22.537, 23.749, 25.049, 26.447, 27.95, 29.569, 31.312, 33.193, 35.222, 37.414, 39.784, 42.348, 45.123, 48.13, 51.389],
    // density along the line in units of rho0 r0^-3/2, kappa / (xi J f) with J = xi - chi dxi/dchi; it diverges at
    // the surface, where the cold flow starts from rest (f -> 0), so the first value stands for that limit
    ETA: [9712.7, 114.84, 53.297, 32.953, 22.902, 16.963, 13.075, 10.357, 8.3677, 6.8612, 5.6909, 4.7635, 4.0166, 3.4074, 2.9051, 2.4872, 2.137, 1.8416, 1.5911, 1.3778, 1.1953, 1.0387, 0.90395, 0.78766, 0.68709, 0.59995, 0.52432, 0.45859, 0.40138, 0.35155, 0.30808, 0.27015, 0.23702, 0.20807, 0.18275, 0.1606, 0.14122, 0.12424, 0.10938, 0.096359, 0.08495, 0.074951, 0.066187, 0.058503, 0.051767, 0.045861, 0.040682, 0.036141, 0.032161, 0.028672, 0.025615, 0.022938, 0.020595, 0.018547, 0.01676, 0.015202, 0.013849, 0.012678, 0.011669, 0.010805, 0.010072, 0.0094577, 0.0089504, 0.008541],
    // velocity of the gas in units of v_K(r0): F = v_z, G = v_phi, and XIP = dxi/dchi, so (v_R, v_phi, v_z) = (F XIP, G, F)
    F: [-4.5929e-07, 0.016636, 0.034177, 0.052607, 0.071908, 0.092062, 0.11305, 0.13485, 0.15744, 0.1808, 0.20489, 0.2297, 0.25518, 0.28132, 0.30808, 0.33542, 0.36331, 0.39171, 0.4206, 0.44992, 0.47964, 0.50972, 0.54012, 0.5708, 0.60172, 0.63283, 0.6641, 0.69547, 0.72691, 0.75838, 0.78982, 0.8212, 0.85248, 0.8836, 0.91453, 0.94522, 0.97563, 1.0057, 1.0354, 1.0647, 1.0936, 1.1219, 1.1498, 1.177, 1.2036, 1.2296, 1.2548, 1.2793, 1.303, 1.3259, 1.348, 1.3691, 1.3893, 1.4086, 1.4269, 1.4441, 1.4604, 1.4755, 1.4897, 1.5028, 1.515, 1.5262, 1.5365, 1.546],
    G: [1, 0.98014, 0.96029, 0.94045, 0.92062, 0.90082, 0.88104, 0.86131, 0.84163, 0.82202, 0.80248, 0.78305, 0.76372, 0.74452, 0.72547, 0.70659, 0.68788, 0.66937, 0.65108, 0.63302, 0.61521, 0.59767, 0.58041, 0.56345, 0.5468, 0.53048, 0.5145, 0.49887, 0.48361, 0.46871, 0.4542, 0.44009, 0.42637, 0.41305, 0.40015, 0.38767, 0.37561, 0.36397, 0.35276, 0.34198, 0.33163, 0.32173, 0.31225, 0.30322, 0.29464, 0.28649, 0.2788, 0.27156, 0.26477, 0.25845, 0.2526, 0.24723, 0.24236, 0.23799, 0.23414, 0.23083, 0.22809, 0.22594, 0.22442, 0.22357, 0.22343, 0.22406, 0.22552, 0.22792],
    XIP: [2.0609, 1.9789, 1.9015, 1.8284, 1.759, 1.6931, 1.6303, 1.5704, 1.5132, 1.4585, 1.406, 1.3556, 1.3072, 1.2606, 1.2157, 1.1723, 1.1305, 1.09, 1.0508, 1.0129, 0.97604, 0.94029, 0.90556, 0.87178, 0.8389, 0.80686, 0.77563, 0.74515, 0.71538, 0.68629, 0.65784, 0.63, 0.60273, 0.576, 0.54978, 0.52406, 0.49881, 0.474, 0.44962, 0.42564, 0.40205, 0.37885, 0.35601, 0.33353, 0.31139, 0.28961, 0.26817, 0.24709, 0.22636, 0.20601, 0.18604, 0.1665, 0.1474, 0.1288, 0.11074, 0.093289, 0.076514, 0.0605, 0.045335, 0.031109, 0.017912, 0.0058173, -0.0051234, -0.014892]
  };
  // (Disk Lab v2, round 8, the owner: "the lever arm from small to large, rather than one lambda, may look good") The wind
  // takes the solution for the lever arm of each line: lambda(Rf) = LAM.A + LAM.B (Rf / 1 au)^-1/2 within the tables' range,
  // 3.3 at the dust's edge (0.08 au), 2.4 at 0.3 au, 2.0 at 1 au, 1.8 from 3 au out. Large inside, small outside: the
  // opposite of the owner's guess, and what the literature has (DESIGN.md, section 21; the sources read): in simulations of
  // weakly ionized disks lambda is about 1.3-2.5, mostly 1.4-2 (Bai 2017; Béthune, Lesur & Ferreira 2017; Wang, Bai &
  // Goodman 2019; Gressel et al. 2020; Lesur 2021), constant or falling outward (Wang, Bai & Goodman 2019: 2.0 within 20 au,
  // 1.3 beyond; Bai et al. 2016: falling with R), while the ideal, thermally ionized inner rim gives 4-6 (Jacquemin-Ide et
  // al. 2021); the rotating outflows observed give 1.6-1.9 at 1-3 au (Louvet et al. 2018; de Valon et al. 2020). A field
  // stronger relative to the gas gives a larger lambda and a lighter loading (Lesur 2021); outward the wind's base is less
  // magnetized. It also nests the flows as jets and winds are seen to: fast and narrow inside, slow and wide outside. The
  // solutions (BPL) are the cold self-similar ones of tools/bp-wind for lambda = 1.8, 2, 2.5, 3 and 4, each with the lightest
  // loading kappa (two figures) whose solution passes the modified fast surface beyond chi = 62 (as the lambda = 3, kappa = 2
  // of before), so that kappa grows as lambda falls (kappa lambda^2 about 15 for lambda >= 4, 30 at 2, 49 at 1.8); a line
  // between two of them takes the mixture of the two (rows on the same grid of chi; not itself a solution). Cold solutions
  // need lambda > 3/2; below 1.8 the loading needed passes 15 and the tables stop. The terminal speed goes as
  // (2 lambda - 3)^1/2 v_K(r0): at 60 r0 the poloidal speed is 0.62 v_K(r0) for 1.8 and 1.55 for 3. The mass flux goes with
  // the loading the wind-driven accretion asks for, Mdot_wind per ln r0 = Mdot_acc / 2 (lambda - 1) (Bai et al. 2016, eq. 25;
  // Tabone et al. 2022): the density along a line is rho0 (ETA / kappa) (lambda_ref - 1) / (lambda - 1), with rho0 at the
  // irradiation surface's density at 1 au, where lambda = LAM.REF = 2, as RHO_B before. Lines from neighbouring feet do not
  // cross (R at fixed height grows with Rf: checked over the drawn region, see the notes).
  const LAM = { A: 1.5, B: 0.5, MIN: 1.8, MAX: 4, REF: 2 };
  const lamOf = (Rf) => Math.min(LAM.MAX, Math.max(LAM.MIN, LAM.A + LAM.B / Math.sqrt(Rf)));
  const BPL = [
    { LAM: 1.8, KAP: 15.0, A0: 1.847397, B0: -11.98951, // table-l1.8-k15.json
      XI: [1, 1.0411, 1.0837, 1.1281, 1.1742, 1.2224, 1.2726, 1.325, 1.3798, 1.4371, 1.4969, 1.5596, 1.6251, 1.6937, 1.7656, 1.8408, 1.9195, 2.002, 2.0884, 2.1788, 2.2735, 2.3725, 2.4762, 2.5845, 2.6979, 2.8163, 2.9399, 3.0689, 3.2035, 3.3438, 3.4898, 3.6417, 3.7995, 3.9633, 4.1331, 4.3089, 4.4907, 4.6782, 4.8715, 5.0702, 5.2741, 5.483, 5.6963, 5.9136, 6.1344, 6.358, 6.5836, 6.8104, 7.0374, 7.2636, 7.4877, 7.7083, 7.9241, 8.1335, 8.3346, 8.5258, 8.7049, 8.8698, 9.0183, 9.1478, 9.2559, 9.3396, 9.396, 9.4219],
      PHI: [0.011984, -0.25293, -0.52576, -0.8072, -1.0979, -1.3986, -1.71, -2.0328, -2.3676, -2.7154, -3.0767, -3.4526, -3.8437, -4.2511, -4.6756, -5.1182, -5.58, -6.0622, -6.5659, -7.0924, -7.6431, -8.2194, -8.8229, -9.4554, -10.119, -10.815, -11.546, -12.314, -13.122, -13.972, -14.868, -15.812, -16.809, -17.861, -18.974, -20.151, -21.397, -22.718, -24.119, -25.607, -27.189, -28.871, -30.662, -32.57, -34.606, -36.779, -39.101, -41.584, -44.241, -47.087, -50.138, -53.41, -56.923, -60.696, -64.752, -69.115, -73.809, -78.865, -84.31, -90.18, -96.509, -103.34, -110.7, -118.65],
      TAU: [-12.046, 0.52233, 3.5509, 5.4375, 6.8635, 8.0423, 9.0694, 9.9958, 10.852, 11.659, 12.43, 13.176, 13.904, 14.62, 15.329, 16.037, 16.745, 17.458, 18.179, 18.91, 19.654, 20.413, 21.19, 21.988, 22.809, 23.656, 24.531, 25.438, 26.379, 27.357, 28.377, 29.441, 30.553, 31.718, 32.939, 34.222, 35.572, 36.994, 38.494, 40.079, 41.756, 43.532, 45.416, 47.417, 49.544, 51.808, 54.221, 56.795, 59.544, 62.482, 65.625, 68.992, 72.6, 76.472, 80.628, 85.093, 89.895, 95.061, 100.62, 106.61, 113.07, 120.03, 127.54, 135.65],
      ETA: [2.3091e+05, 2575.4, 1202.4, 747.79, 522.69, 389.31, 301.75, 240.31, 195.17, 160.85, 134.08, 112.77, 95.546, 81.429, 69.739, 59.972, 51.751, 44.788, 38.859, 33.787, 29.433, 25.682, 22.441, 19.635, 17.199, 15.081, 13.237, 11.628, 10.224, 8.9969, 7.9231, 6.983, 6.1592, 5.4369, 4.8033, 4.2471, 3.7586, 3.3294, 2.9521, 2.6203, 2.3284, 2.0715, 1.8453, 1.6461, 1.4705, 1.3157, 1.1793, 1.0589, 0.95261, 0.8588, 0.77596, 0.70278, 0.63812, 0.58097, 0.53045, 0.4858, 0.44635, 0.41149, 0.38073, 0.3536, 0.32971, 0.30872, 0.29034, 0.27431],
      F: [-1.2163e-07, 0.0055891, 0.011467, 0.017631, 0.024078, 0.030808, 0.03782, 0.045113, 0.052688, 0.060544, 0.068682, 0.077102, 0.085803, 0.094784, 0.10404, 0.11358, 0.12339, 0.13348, 0.14382, 0.15443, 0.16528, 0.17638, 0.18771, 0.19926, 0.21101, 0.22295, 0.23506, 0.24732, 0.25972, 0.27223, 0.28483, 0.2975, 0.31021, 0.32294, 0.33566, 0.34835, 0.36099, 0.37354, 0.38599, 0.39831, 0.41049, 0.42249, 0.4343, 0.44591, 0.45729, 0.46842, 0.47931, 0.48992, 0.50027, 0.51033, 0.52011, 0.5296, 0.5388, 0.54771, 0.55635, 0.56471, 0.5728, 0.58063, 0.58822, 0.59559, 0.60274, 0.6097, 0.61649, 0.62313],
      G: [1, 0.9752, 0.95081, 0.92681, 0.90317, 0.87988, 0.85691, 0.83426, 0.81192, 0.7899, 0.76817, 0.74676, 0.72566, 0.70487, 0.6844, 0.66426, 0.64445, 0.62499, 0.60588, 0.58713, 0.56875, 0.55075, 0.53314, 0.51593, 0.49913, 0.48274, 0.46677, 0.45123, 0.43613, 0.42146, 0.40724, 0.39347, 0.38014, 0.36727, 0.35485, 0.34287, 0.33135, 0.32028, 0.30965, 0.29946, 0.28971, 0.28039, 0.2715, 0.26304, 0.255, 0.24737, 0.24016, 0.23335, 0.22694, 0.22093, 0.21532, 0.21009, 0.20526, 0.20083, 0.19678, 0.19313, 0.18989, 0.18706, 0.18465, 0.18268, 0.18117, 0.18016, 0.17968, 0.17978],
      XIP: [1.8515, 1.7617, 1.6786, 1.6012, 1.5291, 1.4616, 1.3981, 1.3384, 1.2819, 1.2285, 1.1778, 1.1297, 1.0838, 1.04, 0.99809, 0.95799, 0.91955, 0.88262, 0.8471, 0.81289, 0.7799, 0.74805, 0.71726, 0.68747, 0.65861, 0.63063, 0.60348, 0.5771, 0.55147, 0.52654, 0.50229, 0.47867, 0.45567, 0.43326, 0.41142, 0.39013, 0.36938, 0.34915, 0.32944, 0.31023, 0.29152, 0.2733, 0.25557, 0.23834, 0.22159, 0.20534, 0.18958, 0.17432, 0.15957, 0.14533, 0.1316, 0.1184, 0.10573, 0.093595, 0.082001, 0.070951, 0.060449, 0.050493, 0.04108, 0.032205, 0.023858, 0.016023, 0.0086787, 0.001798] },
    { LAM: 2.0, KAP: 7.4, A0: 1.917609, B0: -7.39413, // table-l2-k7.4.json
      XI: [1, 1.0427, 1.0872, 1.1336, 1.1821, 1.2328, 1.2858, 1.3412, 1.3992, 1.4599, 1.5235, 1.59, 1.6598, 1.7328, 1.8093, 1.8894, 1.9733, 2.0612, 2.1531, 2.2494, 2.3501, 2.4554, 2.5655, 2.6805, 2.8006, 2.9258, 3.0564, 3.1924, 3.334, 3.4811, 3.6339, 3.7923, 3.9563, 4.1258, 4.3008, 4.481, 4.6661, 4.856, 5.0502, 5.2481, 5.4493, 5.653, 5.8584, 6.0646, 6.2704, 6.4746, 6.6758, 6.8723, 7.0625, 7.2442, 7.4154, 7.5736, 7.7162, 7.8403, 7.9429, 8.0206, 8.0696, 8.0858, 8.0646, 8.0004, 7.8865, 7.7137, 7.4683, 7.1258],
      PHI: [0.00739, -0.15599, -0.32426, -0.49785, -0.67716, -0.86261, -1.0546, -1.2537, -1.4603, -1.6748, -1.8979, -2.1301, -2.372, -2.6241, -2.8872, -3.1619, -3.449, -3.7492, -4.0635, -4.3927, -4.7379, -5.1, -5.4802, -5.8798, -6.3, -6.7423, -7.2081, -7.6992, -8.2173, -8.7644, -9.3426, -9.9541, -10.601, -11.287, -12.015, -12.786, -13.606, -14.478, -15.405, -16.393, -17.446, -18.569, -19.768, -21.05, -22.421, -23.888, -25.46, -27.146, -28.954, -30.897, -32.984, -35.228, -37.643, -40.244, -43.046, -46.066, -49.323, -52.836, -56.626, -60.716, -65.129, -69.889, -75.02, -80.542],
      TAU: [-7.3206, 0.31937, 2.1584, 3.3095, 4.1758, 4.892, 5.5145, 6.0762, 6.5957, 7.0853, 7.5536, 8.0069, 8.45, 8.8869, 9.3204, 9.7535, 10.188, 10.627, 11.072, 11.524, 11.986, 12.458, 12.944, 13.444, 13.961, 14.495, 15.05, 15.627, 16.227, 16.854, 17.51, 18.197, 18.917, 19.675, 20.472, 21.312, 22.199, 23.137, 24.129, 25.182, 26.299, 27.485, 28.748, 30.093, 31.528, 33.059, 34.697, 36.448, 38.324, 40.335, 42.493, 44.81, 47.302, 49.982, 52.867, 55.976, 59.327, 62.942, 66.843, 71.054, 75.602, 80.513, 85.817, 91.544],
      ETA: [68714, 770.01, 358.67, 222.6, 155.28, 115.43, 89.31, 71.009, 57.582, 47.391, 39.455, 33.149, 28.057, 23.892, 20.447, 17.574, 15.158, 13.114, 11.376, 9.89, 8.6155, 7.5183, 6.5708, 5.7506, 5.039, 4.4203, 3.8816, 3.4117, 3.0014, 2.6427, 2.3289, 2.0539, 1.813, 1.6016, 1.4161, 1.2532, 1.1101, 0.9843, 0.87372, 0.77647, 0.69092, 0.61563, 0.54938, 0.49106, 0.43971, 0.39452, 0.35473, 0.3197, 0.28888, 0.26177, 0.23794, 0.217, 0.19863, 0.18254, 0.16846, 0.15618, 0.1455, 0.13625, 0.12826, 0.12139, 0.11547, 0.1103, 0.1055, 0.10011],
      F: [-2.2111e-07, 0.009208, 0.018905, 0.029082, 0.03973, 0.050841, 0.062407, 0.074418, 0.086866, 0.09974, 0.11303, 0.12672, 0.14081, 0.15527, 0.1701, 0.18529, 0.20081, 0.21664, 0.23278, 0.2492, 0.26589, 0.28282, 0.29996, 0.31731, 0.33483, 0.35249, 0.37028, 0.38815, 0.4061, 0.42408, 0.44207, 0.46003, 0.47793, 0.49575, 0.51345, 0.53099, 0.54835, 0.5655, 0.5824, 0.59903, 0.61535, 0.63133, 0.64696, 0.6622, 0.67703, 0.69144, 0.70541, 0.71891, 0.73195, 0.74451, 0.75659, 0.7682, 0.77934, 0.79003, 0.80029, 0.81014, 0.81962, 0.82879, 0.83768, 0.84639, 0.85499, 0.86363, 0.87249, 0.88198],
      G: [1, 0.97567, 0.95164, 0.9279, 0.90444, 0.88127, 0.85838, 0.83577, 0.81345, 0.79142, 0.76969, 0.74828, 0.72718, 0.70641, 0.68598, 0.6659, 0.64619, 0.62684, 0.60788, 0.58931, 0.57115, 0.5534, 0.53606, 0.51916, 0.5027, 0.48668, 0.47111, 0.45599, 0.44133, 0.42714, 0.41341, 0.40015, 0.38737, 0.37505, 0.36321, 0.35184, 0.34094, 0.33052, 0.32056, 0.31108, 0.30208, 0.29354, 0.28548, 0.27789, 0.27078, 0.26416, 0.25802, 0.25237, 0.24723, 0.24261, 0.23852, 0.23499, 0.23205, 0.22972, 0.22806, 0.22713, 0.22701, 0.2278, 0.22965, 0.23277, 0.23747, 0.24423, 0.2539, 0.26813],
      XIP: [1.9217, 1.8354, 1.7547, 1.6789, 1.6075, 1.5402, 1.4764, 1.4159, 1.3583, 1.3035, 1.2512, 1.2011, 1.1532, 1.1072, 1.063, 1.0205, 0.97958, 0.9401, 0.90198, 0.86514, 0.82948, 0.79494, 0.76145, 0.72895, 0.69737, 0.66667, 0.63679, 0.60769, 0.57933, 0.55168, 0.52469, 0.49834, 0.47259, 0.44743, 0.42282, 0.39876, 0.37522, 0.35218, 0.32965, 0.3076, 0.28603, 0.26494, 0.24434, 0.22421, 0.20457, 0.18543, 0.16679, 0.14867, 0.13109, 0.11407, 0.097615, 0.081753, 0.066498, 0.051864, 0.037856, 0.024471, 0.011689, -0.00053512, -0.012284, -0.023701, -0.035045, -0.046795, -0.059962, -0.077259] },
    { LAM: 2.5, KAP: 3.3, A0: 2.029462, B0: -4.94672, // table-l2.5-k3.3.json
      XI: [1, 1.0453, 1.0926, 1.1421, 1.194, 1.2484, 1.3054, 1.3652, 1.4279, 1.4938, 1.563, 1.6356, 1.7119, 1.792, 1.8762, 1.9646, 2.0574, 2.155, 2.2574, 2.3649, 2.4777, 2.5961, 2.7203, 2.8505, 2.987, 3.1299, 3.2795, 3.436, 3.5995, 3.7704, 3.9486, 4.1344, 4.3279, 4.529, 4.7379, 4.9546, 5.1788, 5.4106, 5.6495, 5.8954, 6.1478, 6.4061, 6.6697, 6.9377, 7.2092, 7.483, 7.7577, 8.0318, 8.3034, 8.5706, 8.8311, 9.0822, 9.3214, 9.5455, 9.7514, 9.9355, 10.095, 10.225, 10.322, 10.384, 10.405, 10.383, 10.314, 10.194],
      PHI: [0.0049433, -0.10437, -0.217, -0.33322, -0.45331, -0.57756, -0.70625, -0.83971, -0.97825, -1.1222, -1.272, -1.4279, -1.5904, -1.76, -1.937, -2.1219, -2.3154, -2.5179, -2.73, -2.9525, -3.1859, -3.4311, -3.6887, -3.9598, -4.2451, -4.5458, -4.8628, -5.1973, -5.5507, -5.9242, -6.3193, -6.7376, -7.1808, -7.6508, -8.1496, -8.6794, -9.2425, -9.8416, -10.48, -11.159, -11.884, -12.658, -13.484, -14.368, -15.313, -16.325, -17.41, -18.573, -19.822, -21.163, -22.605, -24.156, -25.826, -27.626, -29.566, -31.66, -33.921, -36.364, -39.006, -41.863, -44.955, -48.302, -51.928, -55.856],
      TAU: [-4.856, 0.21468, 1.4404, 2.201, 2.7757, 3.2515, 3.6647, 4.0377, 4.383, 4.7084, 5.0198, 5.3214, 5.6164, 5.9074, 6.1965, 6.4854, 6.7759, 7.0692, 7.3667, 7.6697, 7.9794, 8.2969, 8.6234, 8.9601, 9.3082, 9.6691, 10.044, 10.434, 10.841, 11.266, 11.711, 12.178, 12.668, 13.184, 13.728, 14.301, 14.907, 15.548, 16.227, 16.947, 17.712, 18.525, 19.391, 20.313, 21.297, 22.348, 23.472, 24.674, 25.963, 27.344, 28.827, 30.42, 32.133, 33.977, 35.964, 38.106, 40.418, 42.914, 45.612, 48.53, 51.688, 55.107, 58.812, 62.827],
      ETA: [19641, 227.33, 105.64, 65.397, 45.508, 33.749, 26.049, 20.662, 16.716, 13.725, 11.4, 9.5556, 8.0691, 6.8552, 5.8532, 5.0189, 4.3188, 3.7276, 3.2257, 2.7977, 2.4311, 2.1162, 1.8447, 1.6102, 1.4071, 1.2309, 1.0778, 0.94449, 0.82832, 0.72696, 0.63844, 0.56107, 0.49339, 0.43415, 0.38227, 0.33681, 0.29696, 0.26202, 0.23136, 0.20447, 0.18087, 0.16015, 0.14196, 0.12599, 0.11196, 0.099646, 0.088833, 0.07934, 0.071007, 0.063696, 0.057285, 0.051667, 0.04675, 0.042453, 0.038705, 0.035443, 0.032616, 0.030175, 0.02808, 0.026297, 0.024795, 0.023548, 0.022532, 0.021729],
      F: [-3.5826e-07, 0.013874, 0.028486, 0.043819, 0.059858, 0.076587, 0.093989, 0.11205, 0.13074, 0.15005, 0.16995, 0.19042, 0.21144, 0.23299, 0.25503, 0.27755, 0.30051, 0.32388, 0.34763, 0.37174, 0.39617, 0.42089, 0.44587, 0.47107, 0.49646, 0.522, 0.54767, 0.57341, 0.59919, 0.62499, 0.65075, 0.67645, 0.70204, 0.72749, 0.75275, 0.77779, 0.80257, 0.82705, 0.85119, 0.87495, 0.8983, 0.92119, 0.94359, 0.96546, 0.98677, 1.0075, 1.0275, 1.047, 1.0657, 1.0836, 1.1009, 1.1173, 1.133, 1.1479, 1.1619, 1.1752, 1.1876, 1.1992, 1.2101, 1.2203, 1.2298, 1.2387, 1.2471, 1.2551],
      G: [1, 0.9775, 0.95516, 0.93297, 0.91093, 0.88905, 0.86733, 0.84578, 0.82441, 0.80324, 0.78227, 0.76151, 0.74099, 0.72072, 0.7007, 0.68096, 0.6615, 0.64235, 0.62352, 0.60502, 0.58687, 0.56907, 0.55164, 0.53459, 0.51793, 0.50167, 0.48582, 0.47039, 0.45538, 0.4408, 0.42666, 0.41295, 0.39968, 0.38686, 0.37449, 0.36256, 0.35109, 0.34006, 0.32949, 0.31936, 0.30969, 0.30046, 0.29169, 0.28336, 0.27549, 0.26807, 0.26111, 0.2546, 0.24856, 0.24299, 0.23789, 0.23328, 0.22917, 0.22557, 0.22251, 0.22, 0.21808, 0.21678, 0.21614, 0.21621, 0.21707, 0.2188, 0.2215, 0.22534],
      XIP: [2.0335, 1.9485, 1.8687, 1.7935, 1.7223, 1.6549, 1.5909, 1.53, 1.4719, 1.4164, 1.3633, 1.3124, 1.2635, 1.2165, 1.1713, 1.1278, 1.0857, 1.0451, 1.0058, 0.96783, 0.93099, 0.89526, 0.86056, 0.82683, 0.79403, 0.76209, 0.73096, 0.70061, 0.67099, 0.64206, 0.61378, 0.58612, 0.55906, 0.53254, 0.50657, 0.4811, 0.45612, 0.4316, 0.40754, 0.38391, 0.3607, 0.33791, 0.31553, 0.29355, 0.27197, 0.2508, 0.23004, 0.20972, 0.18983, 0.17042, 0.15151, 0.13313, 0.11532, 0.098138, 0.081634, 0.065869, 0.050901, 0.036791, 0.023595, 0.011354, 9.5735e-05, -0.010177, -0.019493, -0.027918] },
    { LAM: 3.0, KAP: 2.0, A0: 2.05701, B0: -3.99771, // table-l3-k2.json
      XI: [1, 1.0459, 1.094, 1.1445, 1.1974, 1.253, 1.3114, 1.3727, 1.4372, 1.5049, 1.5762, 1.6512, 1.73, 1.813, 1.9003, 1.9921, 2.0887, 2.1904, 2.2973, 2.4097, 2.5279, 2.6521, 2.7827, 2.9198, 3.0638, 3.215, 3.3736, 3.5398, 3.714, 3.8963, 4.0871, 4.2865, 4.4948, 4.712, 4.9383, 5.1739, 5.4186, 5.6726, 5.9356, 6.2076, 6.4881, 6.7769, 7.0733, 7.3768, 7.6864, 8.0012, 8.3199, 8.6411, 8.963, 9.2838, 9.601, 9.9122, 10.214, 10.505, 10.779, 11.034, 11.265, 11.469, 11.64, 11.775, 11.869, 11.919, 11.919, 11.868],
      PHI: [0.0039947, -0.084394, -0.17558, -0.26978, -0.36721, -0.4681, -0.57269, -0.68123, -0.79399, -0.91124, -1.0333, -1.1604, -1.293, -1.4314, -1.576, -1.7271, -1.8852, -2.0508, -2.2244, -2.4065, -2.5976, -2.7984, -3.0095, -3.2316, -3.4656, -3.7122, -3.9722, -4.2468, -4.5368, -4.8434, -5.1677, -5.5112, -5.8752, -6.2612, -6.6709, -7.106, -7.5685, -8.0605, -8.5843, -9.1424, -9.7374, -10.372, -11.05, -11.775, -12.55, -13.38, -14.268, -15.221, -16.242, -17.34, -18.518, -19.786, -21.149, -22.618, -24.2, -25.907, -27.748, -29.737, -31.887, -34.211, -36.727, -39.45, -42.4, -45.597],
      TAU: [-4.0518, 0.1778, 1.2026, 1.8367, 2.3168, 2.712, 3.0559, 3.3658, 3.6529, 3.923, 4.1815, 4.4316, 4.6761, 4.9172, 5.1565, 5.3957, 5.6359, 5.8785, 6.1245, 6.3749, 6.6307, 6.8929, 7.1625, 7.4404, 7.7276, 8.0253, 8.3344, 8.6561, 8.9916, 9.342, 9.7088, 10.093, 10.497, 10.922, 11.369, 11.841, 12.34, 12.867, 13.425, 14.017, 14.645, 15.313, 16.024, 16.781, 17.588, 18.449, 19.37, 20.354, 21.408, 22.537, 23.749, 25.049, 26.447, 27.95, 29.569, 31.312, 33.193, 35.222, 37.414, 39.784, 42.348, 45.123, 48.13, 51.389],
      ETA: [9712.7, 114.84, 53.297, 32.953, 22.902, 16.963, 13.075, 10.357, 8.3677, 6.8612, 5.6909, 4.7635, 4.0166, 3.4074, 2.9051, 2.4872, 2.137, 1.8416, 1.5911, 1.3778, 1.1953, 1.0387, 0.90395, 0.78766, 0.68709, 0.59995, 0.52432, 0.45859, 0.40138, 0.35155, 0.30808, 0.27015, 0.23702, 0.20807, 0.18275, 0.1606, 0.14122, 0.12424, 0.10938, 0.096359, 0.08495, 0.074951, 0.066187, 0.058503, 0.051767, 0.045861, 0.040682, 0.036141, 0.032161, 0.028672, 0.025615, 0.022938, 0.020595, 0.018547, 0.01676, 0.015202, 0.013849, 0.012678, 0.011669, 0.010805, 0.010072, 0.0094577, 0.0089504, 0.008541],
      F: [-4.5929e-07, 0.016636, 0.034177, 0.052607, 0.071908, 0.092062, 0.11305, 0.13485, 0.15744, 0.1808, 0.20489, 0.2297, 0.25518, 0.28132, 0.30808, 0.33542, 0.36331, 0.39171, 0.4206, 0.44992, 0.47964, 0.50972, 0.54012, 0.5708, 0.60172, 0.63283, 0.6641, 0.69547, 0.72691, 0.75838, 0.78982, 0.8212, 0.85248, 0.8836, 0.91453, 0.94522, 0.97563, 1.0057, 1.0354, 1.0647, 1.0936, 1.1219, 1.1498, 1.177, 1.2036, 1.2296, 1.2548, 1.2793, 1.303, 1.3259, 1.348, 1.3691, 1.3893, 1.4086, 1.4269, 1.4441, 1.4604, 1.4755, 1.4897, 1.5028, 1.515, 1.5262, 1.5365, 1.546],
      G: [1, 0.98014, 0.96029, 0.94045, 0.92062, 0.90082, 0.88104, 0.86131, 0.84163, 0.82202, 0.80248, 0.78305, 0.76372, 0.74452, 0.72547, 0.70659, 0.68788, 0.66937, 0.65108, 0.63302, 0.61521, 0.59767, 0.58041, 0.56345, 0.5468, 0.53048, 0.5145, 0.49887, 0.48361, 0.46871, 0.4542, 0.44009, 0.42637, 0.41305, 0.40015, 0.38767, 0.37561, 0.36397, 0.35276, 0.34198, 0.33163, 0.32173, 0.31225, 0.30322, 0.29464, 0.28649, 0.2788, 0.27156, 0.26477, 0.25845, 0.2526, 0.24723, 0.24236, 0.23799, 0.23414, 0.23083, 0.22809, 0.22594, 0.22442, 0.22357, 0.22343, 0.22406, 0.22552, 0.22792],
      XIP: [2.0609, 1.9789, 1.9015, 1.8284, 1.759, 1.6931, 1.6303, 1.5704, 1.5132, 1.4585, 1.406, 1.3556, 1.3072, 1.2606, 1.2157, 1.1723, 1.1305, 1.09, 1.0508, 1.0129, 0.97604, 0.94029, 0.90556, 0.87178, 0.8389, 0.80686, 0.77563, 0.74515, 0.71538, 0.68629, 0.65784, 0.63, 0.60273, 0.576, 0.54978, 0.52406, 0.49881, 0.474, 0.44962, 0.42564, 0.40205, 0.37885, 0.35601, 0.33353, 0.31139, 0.28961, 0.26817, 0.24709, 0.22636, 0.20601, 0.18604, 0.1665, 0.1474, 0.1288, 0.11074, 0.093289, 0.076514, 0.0605, 0.045335, 0.031109, 0.017912, 0.0058173, -0.0051234, -0.014892] },
    { LAM: 4.0, KAP: 0.97, A0: 1.978559, B0: -2.90869, // table-l4-k0.97.json
      XI: [1, 1.0442, 1.0907, 1.1396, 1.1911, 1.2452, 1.3022, 1.3623, 1.4255, 1.492, 1.5621, 1.636, 1.7138, 1.7958, 1.8821, 1.9731, 2.0689, 2.1698, 2.276, 2.3879, 2.5056, 2.6294, 2.7596, 2.8966, 3.0405, 3.1916, 3.3504, 3.5169, 3.6915, 3.8744, 4.0659, 4.2663, 4.4756, 4.6941, 4.922, 5.1593, 5.406, 5.6621, 5.9275, 6.2021, 6.4854, 6.7772, 7.0768, 7.3836, 7.6966, 8.0147, 8.3366, 8.6608, 8.9852, 9.3077, 9.6258, 9.9363, 10.236, 10.521, 10.786, 11.028, 11.24, 11.417, 11.552, 11.638, 11.668, 11.636, 11.533, 11.35],
      PHI: [0.0029065, -0.061533, -0.12828, -0.19747, -0.26926, -0.34382, -0.42132, -0.50193, -0.58586, -0.67332, -0.76451, -0.85968, -0.95907, -1.063, -1.1716, -1.2854, -1.4045, -1.5294, -1.6605, -1.7981, -1.9427, -2.0947, -2.2546, -2.4231, -2.6006, -2.7878, -2.9854, -3.1941, -3.4146, -3.6479, -3.8949, -4.1565, -4.4338, -4.728, -5.0403, -5.3722, -5.725, -6.1005, -6.5002, -6.9262, -7.3805, -7.8653, -8.3831, -8.9364, -9.5282, -10.162, -10.84, -11.567, -12.347, -13.184, -14.083, -15.05, -16.09, -17.209, -18.414, -19.713, -21.114, -22.626, -24.259, -26.023, -27.931, -29.994, -32.226, -34.641],
      TAU: [-3.3586, 0.14445, 0.98583, 1.5112, 1.9049, 2.2294, 2.5107, 2.7639, 2.9972, 3.2167, 3.426, 3.6282, 3.8252, 4.0191, 4.211, 4.4025, 4.5943, 4.7876, 4.9832, 5.182, 5.3846, 5.592, 5.8047, 6.0238, 6.2498, 6.4836, 6.7261, 6.9781, 7.2405, 7.5143, 7.8006, 8.1004, 8.4149, 8.7453, 9.093, 9.4594, 9.8461, 10.255, 10.687, 11.145, 11.631, 12.148, 12.696, 13.281, 13.903, 14.567, 15.277, 16.035, 16.846, 17.714, 18.645, 19.645, 20.718, 21.871, 23.112, 24.448, 25.887, 27.44, 29.116, 30.927, 32.884, 35.002, 37.294, 39.777],
      ETA: [4071.7, 46.121, 21.391, 13.217, 9.178, 6.7915, 5.2298, 4.1383, 3.3395, 2.7349, 2.2656, 1.8939, 1.5948, 1.3511, 1.1503, 0.98338, 0.84367, 0.72597, 0.62628, 0.54147, 0.46902, 0.40694, 0.35357, 0.30759, 0.26789, 0.23353, 0.20376, 0.17792, 0.15547, 0.13594, 0.11893, 0.10411, 0.091188, 0.079911, 0.070065, 0.061464, 0.053948, 0.047378, 0.041633, 0.036608, 0.032211, 0.028364, 0.024996, 0.022048, 0.019466, 0.017206, 0.015227, 0.013494, 0.011976, 0.010648, 0.0094849, 0.0084673, 0.0075776, 0.0068003, 0.0061221, 0.0055314, 0.0050185, 0.0045746, 0.0041925, 0.0038661, 0.0035902, 0.0033605, 0.003173, 0.0030242],
      F: [-5.8336e-07, 0.020124, 0.041438, 0.063936, 0.087609, 0.11244, 0.13842, 0.16553, 0.19374, 0.22303, 0.25337, 0.28473, 0.31707, 0.35036, 0.38455, 0.41959, 0.45545, 0.49208, 0.52942, 0.56742, 0.60602, 0.64517, 0.68482, 0.7249, 0.76536, 0.80613, 0.84716, 0.88838, 0.92973, 0.97116, 1.0126, 1.054, 1.0952, 1.1363, 1.1772, 1.2178, 1.258, 1.2979, 1.3372, 1.3761, 1.4144, 1.452, 1.489, 1.5252, 1.5607, 1.5953, 1.6291, 1.6619, 1.6937, 1.7245, 1.7543, 1.7829, 1.8104, 1.8367, 1.8617, 1.8855, 1.908, 1.9292, 1.9491, 1.9677, 1.9849, 2.001, 2.0158, 2.0297],
      G: [1, 0.9862, 0.97219, 0.95797, 0.94354, 0.92891, 0.91408, 0.89906, 0.88387, 0.86851, 0.85299, 0.83734, 0.82155, 0.80566, 0.78967, 0.77361, 0.75749, 0.74133, 0.72516, 0.70899, 0.69285, 0.67676, 0.66074, 0.64481, 0.629, 0.61333, 0.59782, 0.5825, 0.56737, 0.55248, 0.53783, 0.52344, 0.50934, 0.49554, 0.48206, 0.46891, 0.45611, 0.44368, 0.43164, 0.41998, 0.40874, 0.39791, 0.38752, 0.37758, 0.36809, 0.35908, 0.35057, 0.34256, 0.33507, 0.32813, 0.32176, 0.31599, 0.31085, 0.30638, 0.30263, 0.29965, 0.29751, 0.2963, 0.29612, 0.29711, 0.29942, 0.30329, 0.30899, 0.31695],
      XIP: [1.982, 1.9096, 1.8406, 1.7747, 1.7118, 1.6515, 1.5937, 1.5382, 1.4849, 1.4336, 1.3843, 1.3366, 1.2907, 1.2463, 1.2034, 1.1619, 1.1217, 1.0827, 1.0448, 1.0081, 0.97234, 0.93759, 0.90375, 0.87078, 0.83863, 0.80726, 0.77662, 0.74668, 0.71739, 0.68872, 0.66065, 0.63313, 0.60613, 0.57964, 0.55362, 0.52805, 0.50291, 0.47817, 0.45381, 0.42982, 0.40617, 0.38286, 0.35986, 0.33716, 0.31476, 0.29263, 0.27079, 0.24921, 0.22791, 0.20688, 0.18612, 0.16566, 0.1455, 0.12567, 0.1062, 0.087133, 0.068521, 0.050427, 0.03293, 0.016115, 7.4022e-05, -0.015114, -0.029412, -0.042877] }
  ];
  const NBP = BPL.length;
  // per table: ln(ETA / kappa) with the loading's factor (lambda_ref - 1) / (lambda - 1)
  for (const T of BPL) T.LNEK = T.ETA.map((e) => Math.log(e / T.KAP) + Math.log((LAM.REF - 1) / (T.LAM - 1)));
  // ln(ETA / kappa) at chi = 0.03 (CHI_C) for the reference lever arm LAM.REF: the wind's density there is RHO_B r0^-3/2
  const LNREF = (() => { const T = BPL.find((t) => t.LAM === LAM.REF), f = Math.log(1 + 0.03 / BP.C0) * (63 / BP.SMAX), i = Math.floor(f); return T.LNEK[i] + (T.LNEK[i + 1] - T.LNEK[i]) * (f - i); })();
  const FIELD_GLSL = `
// (round 8) the solutions for several lever arms (BPL in the script) as a texture, NBP rows of (xi, PHI, TAU, ln(ETA / kappa)
// with the loading's factor) at chi_i = C0 (e^(s_i) - 1), s_i = i SMAX / 63, and NBP more of (F, G, XIP); uBPL[j]: the
// lambda, the dR/dz and B_phi/B_z where the line leaves the surface of row j. A line takes the lever arm of its foot, lamOf,
// between two rows (the wind map only reads them: it is drawn once, not every frame)
#define NBP ${NBP}
uniform highp sampler2D uBPT;
uniform vec4 uBPL[NBP];
const float C0 = ${G(BP.C0)}, SMAX = ${G(BP.SMAX)}, CHIMAX = ${G(BP.CHIMAX)};
float cutOut(float R){ return pow(R / R_OUT, P_OUT); }      // -ln of the density cutoff
float zBase(float Rf){ float H = H0 * pow(Rf, 1.25); return H * sqrt(2.0 * max(${G(MODEL.LNTAU1)} - 1.25 * log(Rf) - cutOut(Rf), 1.0)); }
float lamOf(float Rf){ return clamp(${G(LAM.A)} + ${G(LAM.B)} * inversesqrt(Rf), ${G(LAM.MIN)}, ${G(LAM.MAX)}); }
// the rows of the line with foot Rf: j, and the share of row j + 1
vec2 lamRow(float Rf){
  float l = lamOf(Rf); int j = 0;
  for (int k = 1; k < NBP - 1; k++) if (l >= uBPL[k].x) j = k;
  return vec2(float(j), clamp((l - uBPL[j].x) / (uBPL[j + 1].x - uBPL[j].x), 0.0, 1.0));
}
vec2 lineAB(float Rf){ vec2 r = lamRow(Rf); int j = int(r.x); return mix(uBPL[j].yz, uBPL[j + 1].yz, r.y); }   // (A0, B0)
vec4 tabRow(int j, float f){ f = clamp(f, 0.0, 62.999); int i = int(f); return mix(texelFetch(uBPT, ivec2(i, j), 0), texelFetch(uBPT, ivec2(i + 1, j), 0), f - float(i)); }
vec4 tabAt(float chi, float Rf){ float f = log(1.0 + chi / C0) * (63.0 / SMAX); vec2 r = lamRow(Rf); int j = int(r.x); return mix(tabRow(j, f), tabRow(j + 1, f), r.y); }
vec4 tabVAt(float chi, float Rf){ float f = log(1.0 + chi / C0) * (63.0 / SMAX); vec2 r = lamRow(Rf); int j = int(r.x); return mix(tabRow(j + NBP, f), tabRow(j + 1 + NBP, f), r.y); }
// The line inside the disk (see NONIDEAL): vertical up to the dead zone's top z_k, where the field does not couple and
// no current flows, then bending into the wind: its slope dR/dz rises linearly from 0 to the wind's A0 over DZ_BEND H
// above z_k, and stays A0 up to the base z_b (the steady induction equation in height, tools/bp-wind/kink.py, puts 80%
// of the bend within 0.6 H above z_k and the line nearly straight above it). Its toroidal field follows the same
// profile up to the wind's B0. bendQ is the integral of that profile, Q = ∫ s dz, so R = Rf + A0 Q and the azimuth is
// B0 Q / Rf. Where there is no dead zone (the thermally ionized inner disk, the outer disk) the bend is at the midplane.
// With the wind's asymmetry (the field aligned with the rotation; Mori, Bai & Tomida 2025) the horizontal field keeps
// one direction through the dead zone, the upper wind's, at a share s of it (ASYM_F = 0.5 of the wind's slope and twist,
// a choice: the paper's Hall-amplified field is stronger), and the current sheet where it turns is on the lower side,
// where the accretion layer is. So on the upper side the slope rises from s to the wind's (a gentle bend), on the lower
// side it turns from -s to the lower wind's (a sharp one, as the field reverses): the slope's profile s + (1 - s) ramp
// (upper, s >= 0) or -|s| + (1 + |s|) ramp (lower), ramp the symmetric one (0 below z_k, rising over DZ_BEND H, 1 above).
// Its integral: Q_side = Q + s (h - Q) with s signed (+ upper, - lower), Q the symmetric bendQ. The steady induction
// equation in height (tools/bp-wind/kink.py --asym 0.5) puts both bends at z_k with the same widths, the drawn shapes
// within 0.25-0.55 A0 H. s = 0: the symmetric shape.
const float ASYM_F = ${G(ASYM_F_JS)};
float bendQ(float Rf, float h, float zb, float s){
  float H = H0 * pow(Rf, 1.25), d = min(DZ_BEND * H, 0.5 * zb), zk = min(zKinkH(Rf) * H, zb - d), hi = min(h, zb);
  // (round 8: with the asymmetry the lower side's bend, its current layer, rises toward its wind base: see ACC)
  // (only where the Hall effect rules, out to about 10 au: beyond it ambipolar diffusion does and the layer is back at the
  // midplane, Bai 2017, sec. 5.2)
  if (s < 0.0) zk = mix(zk, zb - d, min(-s / ASYM_F, 1.0) * (1.0 - outerAmp(Rf)));
  float q = hi <= zk ? 0.0 : hi < zk + d ? 0.5 * (hi - zk) * (hi - zk) / d : hi - zk - 0.5 * d;
  return q + s * (hi - q);
}
float r0Of(float Rf, float s){ float zb = zBase(Rf); return Rf + lineAB(Rf).x * bendQ(Rf, zb, zb, s); }   // the radius at the wind's base
// (round 8) the lower side's accretion layer (units of H) with the asymmetry's share f (0 to 1): from zAccH toward the middle
// of the raised bend just under its wind base, as bendQ
float zAccLow(float R, float f){ float H = H0 * pow(R, 1.25), zb = zBase(R) / H; return mix(zAccH(R), max(zb - 0.5 * min(DZ_BEND, 0.5 * zb), zAccH(R)), f * (1.0 - outerAmp(R))); }
// radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf, at height h on the side of s
vec2 fieldRP(float Rf, float h, float s){
  float zb = zBase(Rf), q = bendQ(Rf, h, zb, s);
  vec2 ab = lineAB(Rf), rp = vec2(Rf + ab.x * q, ab.y * q / Rf);
  if (h > zb) { vec4 t = tabAt((h - zb) / rp.x, Rf); rp = vec2(rp.x * t.x, rp.y + t.y); }
  return rp;
}
// foot radius of the line through (R, h): R(Rf) is monotonic at fixed h (nested lines, also where they
// turn back toward the axis), so bisect (once per point of the wind map, so to full precision)
float footRadius(float R, float h, float s){
  float lo = 0.05, hi = max(R, 0.05) + 2.0 * 2.1 * ASYM_F * H0 * pow(max(R, 0.05), 1.25) * 4.0;   // (2.1: the largest A0)
  for (int i = 0; i < 28; i++) { float m = 0.5 * (lo + hi); if (fieldRP(m, h, s).x > R) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
`;
  // Scattered starlight. The wind carries small grains, so the field lines and the wind glow shine by
  // starlight scattered toward the observer, and so does the irradiated surface of the disk. Henyey-
  // Greenstein phase functions in the scattering angle star -> point -> observer, with the asymmetry
  // chosen for the picture: strongly forward for the wind (g = 0.6: 25 times brighter straight ahead
  // than at 90 degrees, given relative to 90 degrees and softly limited so the peak does not burn out),
  // near-isotropic for the disk surface (g = 0.3: 2.7 straight ahead, 0.4 straight back, mean 1).
  const SCATTER_GLSL = `
const float G_WIND_HG = 0.6, G_DISK_HG = 0.3;
float hg(float mu, float g){ return (1.0 - g * g) * pow(1.0 + g * g - 2.0 * g * mu, -1.5); }   // mean 1 over all directions
float phaseHG(float mu){ float p = hg(mu, G_WIND_HG) / hg(0.0, G_WIND_HG); return p / (1.0 + p / 8.0); }
// the wind gas, seen through long paths toward the star, has its forward peak limited more (to 3)
float phaseGas(float mu){ float p = hg(mu, G_WIND_HG) / hg(0.0, G_WIND_HG); return p / (1.0 + p / 3.0); }
float phaseDisk(float mu){ return hg(mu, G_DISK_HG); }
`;
  const VS = `#version 300 es
layout(location = 0) in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

  // Constants, noise and the turbulent structure, shared by the passes on the GPU
  const CONST_GLSL = `
const float PI = 3.14159265, TAU = 6.2831853;
const float R_IN = ${G(MODEL.R_IN)}, H0 = ${G(MODEL.H0)}, TICE = ${G(MODEL.TICE)};
const float R_OUT = ${G(MODEL.R_OUT)}, P_OUT = ${G(MODEL.P_OUT)};   // the disk ends in a density cutoff exp(-(R/R_OUT)^P_OUT)
const float LNTAU1 = ${G(MODEL.LNTAU1)};               // ln of the grazing optical depth toward the star at the midplane, 1 au
// the temperature (round 7, see THERMO in the script): T_i^4 = TH_KI beta / R^2 and T_ds^5 = TH_KDS5 / R^2, both times the
// star's luminosity uLum (the outburst), T_acc^4 = TH_KM / R^3 (at the midplane), T_vis = TH_KV R^-0.9
const float TH_KI = ${G(+THERMO.KI.toPrecision(6))}, TH_KDS5 = ${G(+THERMO.KDS5.toPrecision(6))}, TH_KM = ${G(+THERMO.KM.toPrecision(6))}, TH_KV = ${G(+THERMO.KV.toPrecision(6))};
const float TH_TAUH = ${G(THERMO.TAU_HEAT)}, TH_TSUB = ${G(THERMO.T_SUB)}, TH_TF4 = ${G(Math.pow(THERMO.T_FLOOR, 4))};
const float OMEGA0 = 0.5236;            // 2π / 12 s at 1 au (visual time)
const float MAG_RS = ${G(MAG.RS)}, MAG_RT = ${G(MAG.RT)};   // the star's radius and the magnetosphere's (au; see MAG)
const float MAG_DL = ${G(MAG.DL)};   // the curtains' bundle of lines: L from MAG_RT to MAG_RT (1 + MAG_DL)
// the curtains' density across the magnetic azimuth, from a curtain's middle (dph): cos^2(dph / 2) cubed, half at 54
// degrees: two broad arcs, as the funnel flows of a slightly tilted dipole (Romanova et al. 2003, 2004), not narrow streams
float magAz(float dph){ float c = 0.5 + 0.5 * cos(dph); return c * c * c; }
const float RB = ${G(RB_JS)}, ZB = ${G(ZB_JS)};   // marched cylinder (au): past the edge of the disk, up to the top of the drawn wind
const float RB_OBS = ${G(RB_OBS)}, ZB_OBS = ${G(ZB_OBS)};   // (round 8) the observed looks' own, the cylinder before round 8
// non-ideal MHD (see NONIDEAL in the script): the thermally ionized inner disk inside R_TI, the dead zone's top z_k (in
// units of H; 0 where there is none) and the height over which the field bends above it (DZ_BEND H)
const float R_TI = ${G(NONIDEAL.R_TI)}, R_DZ = ${G(NONIDEAL.R_DZ)}, DZ_Q = ${G(NONIDEAL.Q)}, DZ_BEND = ${G(NONIDEAL.BEND)}, DZ_TI = ${G(NONIDEAL.TI)};
float mriAmp(float R){ return 1.0 - smoothstep(0.75 * R_TI, 1.15 * R_TI, R); }   // where the magnetorotational instability stirs the gas
// (Disk Lab v2) and where it stirs the outer disk a little, at OUTER_TURB of the inner disk's strength (see NONIDEAL)
const float OUTER_TURB = ${G(NONIDEAL.OUTER)}, DZ_TURB = ${G(NONIDEAL.DZ)}, R_OT0 = ${G(NONIDEAL.R_OT[0])}, R_OT1 = ${G(NONIDEAL.R_OT[1])};
float outerAmp(float R){ return smoothstep(R_OT0, R_OT1, R); }
float zKinkH(float R){ return sqrt(2.0 * max(DZ_Q * log(R_DZ / R) - 0.5 * pow(R / R_OUT, P_OUT) - DZ_TI * mriAmp(R), 0.0)); }
// the accretion layer (see ACC in the script): centred at zAccH, ACC_W H wide, wherever the disk is not turbulent (accAmp)
const float ACC_W = ${G(ACC.W)}, ACC_OFF = ${G(ACC.OFF)}, ACC_SIG = ${G(ACC.SIG)};
// (round 8) its centre, in units of H: the middle of the field's bend above the dead zone's top, coming down to the midplane
// where the dead zone ends; and there wherever the gas is not turbulent (until round 7 only over the dead zone)
float zAccH(float R){ float zk = zKinkH(R); return zk + ACC_OFF * min(zk, 1.0); }
float accAmp(float R){ return 1.0 - mriAmp(R); }
`;
  const PLANET_GLSL = `
// the planets (see PLANET and PLANETS in the script). uPl[i]: the orbit's radius a, the depth of the gap (Σ is lowered by
// the factor 1 - depth e^-x², x = (R - a)/W; it depends on the camera's distance and fades in and out with the planet; 0:
// no planet in that place), the planet's azimuth now, the wake's strength (its presence times the strength for the
// camera's distance). uPlTrap[i]: the radius of the pressure maximum outside the gap, the fraction of the pebbles filtered
// out of the gap and the strength of their trap at that maximum (see trapOf in the script). uPlRim[i]: the gap's inner
// rim (see xRim). uPlV: the planet shown close up (its position; w: how much, see planetLight), uPlVa its orbit's radius.
#define MAXP ${PLANETS.MAX}
uniform int uNP;            // how many of uPl act now (they come first: the loops stop there)
uniform vec4 uPl[MAXP];
uniform vec4 uPlTrap[MAXP];
uniform vec4 uPlGap[MAXP];  // (round 6) each gap's profile (Kanagawa et al. 2017, see gapK in the script): dR1, dR2, K'^1/4 a, Sigma_min / Sigma_0
uniform vec4 uPlRim[MAXP];
uniform vec4 uPlV;
// (round 7) every shown planet as a point of light, seen from afar: its position and its glow (its presence, times the
// look's gain, less as its own disk shows close up), see planetGlowSet in the script
uniform vec4 uPlG[MAXP];
const float PG_R = 26.0, PG_A = 2.2, PG_H = 0.16;   // the reach (CSS px), the core's and the halo's brightness
// (the glow met by this ray, the nearest planet's on the screen within PG_R px: its depth along the ray and its light, laid
// in as the march passes it, so that the disk in front of a planet dims it as it dims the star. One, not one per planet:
// arrays held through the march cost registers, and the whole march slowed)
uniform float uPlVa;
uniform float uWakeX;       // the waves' emphasis (0: the wake's physical amplitude, 1: exaggerated; eased), see wake
// the share of planet i's gap depth at R: 1 in its floor, falling linearly across its walls to 0 (as gapShape in the script)
float gapShape(int i, float R){
  vec4 g = uPlGap[i];
  float y = abs(R - uPl[i].x);
  return y >= g.y ? 0.0 : y <= g.x ? 1.0 : (1.32 - 4.0 * y / g.z) / (1.0 - g.w);
}
uniform float uPlVq;        // (round 8) the mass ratio of the planet shown close up
float rCPD(float a){ return 0.4 * pow(uPlVq / 3.0, 1.0 / 3.0) * a; }   // radius of the planet's disk, 0.4 Hill radii
float hP(float a){ return ${G(MODEL.H0)} * pow(a, 0.25); }
const float WAKE_A = ${G(PLANET.WAKE_A)}, WAKE_L = ${G(PLANET.WAKE_L)}, WAKE_P = ${G(PLANET.WAKE_P)}, WAKE_X0 = ${G(PLANET.WAKE_X0)}, WAKE_NI = ${G(PLANET.WAKE_NI)}, WAKE_NO = ${G(PLANET.WAKE_NO)};
// the factor by which the gaps lower Σ, its ln, and the gaps' share of -d ln Σ / d ln R (for the CO line's pressure
// gradient): from a table on GT_N radii, uniform in ln R from 0.02 to 40 au (gapTable in the script; 34 texels per
// gap width at 1 au, more farther out), made again when a gap changes. Evaluated in the march many times a step, a table
// costs two fetches where a loop over the planets cost a fifth to a third of the frame.
uniform highp sampler2D uGapT;
uniform vec2 uGapR;         // the radii between which some gap acts (outside them the march pays nothing for the gaps)
const float GT_LN0 = ${G(+Math.log(0.02).toFixed(6))}, GT_DLN = ${G(+(Math.log(2000) / (GT_N - 1)).toFixed(8))};
vec2 gapT(float R){
  if (R <= uGapR.x || R >= uGapR.y) return vec2(0.0);
  float f = (log(R) - GT_LN0) / GT_DLN;
  if (f <= 0.0 || f >= ${G(GT_N - 1)}) return vec2(0.0);
  int j = int(f);
  return mix(texelFetch(uGapT, ivec2(j, 0), 0).rg, texelFetch(uGapT, ivec2(j + 1, 0), 0).rg, f - float(j));
}
float gapLn(float R){ return gapT(R).x; }
float gapFactor(float R){ return R <= uGapR.x || R >= uGapR.y ? 1.0 : exp(gapT(R).x); }
`;
  const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(p.xyx * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// value noise in [-0.5, 0.5] with its gradient, periodic with period n along x (the azimuth)
vec3 vnoiseD(vec2 q, float n){
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float i0 = mod(i.x, n), i1 = mod(i.x + 1.0, n);
  float a = hash12(vec2(i0, i.y)), b = hash12(vec2(i1, i.y)), c = hash12(vec2(i0, i.y + 1.0)), d = hash12(vec2(i1, i.y + 1.0));
  float k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y - 0.5, du * vec2(k1 + k3 * u.y, k2 + k3 * u.x));
}
float vnoiseP(vec2 q, float n){
  vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  float i0 = mod(i.x, n), i1 = mod(i.x + 1.0, n);
  return mix(mix(hash12(vec2(i0, i.y)), hash12(vec2(i1, i.y)), f.x),
             mix(hash12(vec2(i0, i.y + 1.0)), hash12(vec2(i1, i.y + 1.0)), f.x), f.y) - 0.5;
}
// the same in three dimensions (standard deviation 0.185, against 0.215 in two)
float vnoise3(vec3 q, float n){
  vec3 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  float i0 = mod(i.x, n), i1 = mod(i.x + 1.0, n);
  vec4 lo = vec4(hash13(vec3(i0, i.y, i.z)), hash13(vec3(i1, i.y, i.z)), hash13(vec3(i0, i.y + 1.0, i.z)), hash13(vec3(i1, i.y + 1.0, i.z)));
  vec4 hi = vec4(hash13(vec3(i0, i.y, i.z + 1.0)), hash13(vec3(i1, i.y, i.z + 1.0)), hash13(vec3(i0, i.y + 1.0, i.z + 1.0)), hash13(vec3(i1, i.y + 1.0, i.z + 1.0)));
  vec4 m = mix(lo, hi, f.z);
  return mix(mix(m.x, m.y, f.x), mix(m.z, m.w, f.x), f.y) - 0.5;
}
`;
  const TURB_GLSL = `
const vec2 CELLS = vec2(32.0, 12.0);    // turbulent cells around the disk and per unit ln R
const float TILT_PITCH = 0.5;           // tan of the pitch of a structure when it forms (27 degrees)
// Turbulent structure in (ln R, φ), carried around by Keplerian rotation and sheared by it. A
// structure lives about LIFE/Ω and is then replaced, so the spirals keep a steady pitch at every
// radius instead of winding up. Lifetimes come in bands four times apart (blended in radius), each
// with two staggered generations (blended in time). fp is the pixel footprint in ln R: unresolved
// detail fades out; launchOffset is relative to the model clock (zero for the disk, -tau/Om for gas launched into the
// wind); cells = (cells around, cells per unit ln R). Returns the relative
// perturbation of the first octave and, with fine = true, that of both octaves and the slope along ln R
// in units of the local wavenumber. (turbL: with a lifetime life/Ω of one's own.)
// The generations' phase comes split from the script (uploadPhaseClock): the integer count of lifetimes and the fraction
// of the current one, so that float32 keeps it exact however long the clock has run (from origin/main's dc55d44; a
// shader that divided the clock by the period lost the phase after an hour or so for the fastest bands).
uniform highp int uFpGeneration[16];
uniform float uFpResidual[16];
uniform float uFpPeriod[16];
vec2 fpPhase(float band, int k, float launchOffset){
  highp int i = int(band) + 5;
  float x = uFpResidual[i] + .5 * float(k) + launchOffset / uFpPeriod[i];
  highp int carry = int(floor(x));
  return vec2(float(uFpGeneration[i] + carry), fract(x));
}
const float LIFE = 1.5, AGE0 = 0.25;
vec3 turbL(float lnR, float phi, float Om, float fp, float seed, bool fine, float launchOffset, vec2 cells, float life){
  float b = log(life / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b));
  vec3 n = vec3(0.0); float w2 = 0.0;
  float tilt = cells.x / TAU / TILT_PITCH;
  for (int j = 0; j < 2; j++) {
    float wb = j == 0 ? 1.0 - bf : bf;
    if (wb <= 0.0) continue;
    float band = floor(b) + float(j), T = uFpPeriod[int(band) + 5];
    for (int k = 0; k < 2; k++) {
      vec2 clock = fpPhase(band, k, launchOffset); float c = clock.x;
      float fc = clock.y, age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
      vec2 dq = vec2(cells.x / TAU * 1.5 * Om * age + tilt, cells.y);   // dq/dlnR after shearing
      float kr = length(dq);
      vec2 q = vec2(cells.x / TAU * (phi - Om * age) + tilt * lnR, cells.y * lnR + seed + 17.0 * floor(c) + 41.0 * float(k) + 29.0 * band);
      float a1 = 1.0 - smoothstep(0.3, 0.7, kr * fp);
      vec3 o;
      if (fine) {
        float a2 = 1.0 - smoothstep(0.3, 0.7, 2.0 * kr * fp);
        vec3 v = vnoiseD(q, cells.x), v2 = vnoiseD(2.0 * q + vec2(0.0, 7.3), 2.0 * cells.x);
        o = vec3(a1 * v.x, 0.7 * a1 * v.x + 0.3 * a2 * v2.x, (0.7 * a1 * dot(v.yz, dq) + 0.3 * a2 * dot(v2.yz, dq)) / kr);
      } else {
        o = vec3(a1 * vnoiseP(q, cells.x), 0.0, 0.0);
      }
      n += w * o; w2 += w * w;
    }
  }
  return n * inversesqrt(w2);
}
vec3 turb(float lnR, float phi, float Om, float fp, float seed, bool fine, float launchOffset, vec2 cells){ return turbL(lnR, phi, Om, fp, seed, fine, launchOffset, cells, LIFE); }
// Strength of the turbulent structure: in the thermally ionized innermost disk (inside R_TI = 0.3 au), where the
// magnetorotational instability works, and weakly in the outer disk (outerAmp, see NONIDEAL); laminar in between
float turbAmp(float R){ float m = mriAmp(R), o = outerAmp(R); return 1.7 * (m + OUTER_TURB * o + DZ_TURB * (1.0 - m) * (1.0 - o)); }   // (round 8: DZ_TURB in the dead zone, see NONIDEAL)
// The structure above spans the whole column (large, slowly sheared structures). Within it, the gas is stirred into
// eddies in three dimensions, about a scale height across radially and vertically and drawn out around the disk by
// the shear, with the same lifetimes (CELLS3: cells around the disk, per unit ln R and per scale height), through the
// whole column. The strength is chosen for the picture. They are drawn into a volume texture every frame (see
// TURB3_FS), which covers R from 0.05 to 0.6 au (the eddies, and the shadows they cast outward) and heights out to
// |z| = ZMAX3 H, beyond which the gas is too thin to matter.
const vec3 CELLS3 = vec3(40.0, 20.0, 0.7);
const float ZMAX3 = 5.5;
const float A3_IN = 1.7;
float turb3Amp(float R, float zeta){ return A3_IN * mriAmp(R) * (1.0 - smoothstep(0.8 * ZMAX3, ZMAX3, abs(zeta))); }
`;
  // Two maps keep the ray march cheap. Neither depends on height above the midplane, so each sample of
  // the march needs one texture fetch where it used to evaluate them again:
  //   the disk map, drawn every frame on (ln R, φ): the turbulent factors of the gas density, of the
  //     brightness of the irradiated skin (including the shadows cast by the corrugation) and of the
  //     pebble sheet. Detail finer than the footprint of a render pixel at that point is faded as the
  //     march did per sample (the footprint of the midplane point seen from the camera, stretched along
  //     the line of sight), and detail finer than about three texels as well, so the map does not alias.
  //   the wind map, drawn once on (ln r, θ) (r the distance from the star, θ the angle above the midplane):
  //     the field line through each point (the radius r0 where it leaves the disk and its azimuth relative
  //     to the foot), the travel time of a gas parcel up to that point, and the gas density of the wind.
  const MAP_GLSL = `
const float LNR_MIN = ${G(Math.log(0.05))}, LNR_SPAN = ${G(Math.log(42 / 0.05))};   // disk map: R from 0.05 to 42 au
const float LN3_MIN = ${G(Math.log(0.05))}, LN3_SPAN = ${G(Math.log(0.6 / 0.05))};       // the eddies' volume: R from 0.05 to 0.6 au
const float LNW_MIN = ${G(Math.log(0.04))}, LNW_SPAN = ${G(Math.log(120.0 / 0.04))};   // wind map: r from 0.04 to 120 au (70 before round 8)
const float RHO_B = ${G(Math.exp(-MODEL.LNTAU1) / (Math.sqrt(2 * Math.PI) * MODEL.H0))};   // gas density at the irradiation surface at 1 au
const float CHI_C = 0.03, WIND_BLEED = 0.03;   // wind density: held below CHI_C, fading into the disk below the base (units of r0)
const float LNE_MIN = ${G(Math.log(0.5))}, LNE_SPAN = ${G(Math.log(ENV.R / 0.5))};   // envelope map: r from 0.5 au to ENV.R
`;
  const DISKMAP_FS = `#version 300 es
precision highp float;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragAcc;   // the accretion layers' streaks (see accTurb)
uniform vec2 uMapRes;   // texels along ln R and φ
uniform vec2 uAccK;     // the inflow in the accretion layers (upper, lower), in units of the sound speed
uniform vec2 uAccC;     // the contrast of their streaks (upper, lower; see accTurb)
uniform float uTime;
uniform float uSeed;
uniform vec3 uCam;
uniform float uPixA;    // angular size of a render pixel
// starlight absorbed per unit area with each planet's gap, relative to the smooth disk: row i for planet i, at
// R = (a / A_REF) (GL_R0 + j GL_DR) (ray traced in the script for a = A_REF, see gapLight there, and scaled with a)
uniform highp sampler2D uPlLight;
${CONST_GLSL}
${PLANET_GLSL}
${FIELD_GLSL}
${NOISE_GLSL}
${TURB_GLSL}
${MAP_GLSL}
const float RELIEF = 0.9;               // brightening per unit slope of the corrugated surface
const float GL_R0 = ${G(GL_R0)}, GL_DR = ${G(GL_DR)}, A_REF = ${G(PLANET.A)};
float gapLight(float R){
  float g = 1.0;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNP) break;
    if (uPl[i].y <= 0.0) continue;
    float f = (R * A_REF / uPl[i].x - GL_R0) / GL_DR;
    if (f <= 0.0 || f >= 127.0) continue;
    int j = int(f);
    g *= mix(texelFetch(uPlLight, ivec2(j, i), 0).r, texelFetch(uPlLight, ivec2(j + 1, i), 0).r, f - float(j));
  }
  return g;
}
// The planet's wake (Rafikov 2002, for c_s ∝ R^-1/4; far from the planet it is the linear wake of Ogilvie & Lubow
// 2002): the spiral density wave launched by the planet, trailing outside its orbit and leading inside, along
// phi_w = phi_p + sgn(x - 1) F(x) / h_p with x = R/a, F = 4.8 - 4 x^-1/4 - 0.8 x^5/4 and h_p = H/R at the planet. In this
// thin disk (h_p = 0.04) both arms wind tightly: the outer one comes round again 1.5 au farther out at 4.5 au, the inner
// one 1.2 au farther in at 2 au. Returns the relative excess of the gas density on the crest, out to 0.45 a and 2.3 a.
// Its physical amplitude (uWakeX = 0, the default): WAKE_P (1) at |x - 1| = WAKE_X0 (0.1, 2.5 scale heights from the
// orbit, about the gap's edge), as a planet of some 16 thermal masses (q = 1e-3 against h_p^3 = 6.4e-5) raises crests of
// order unity next to it, its wake shocking within a scale height (Goodman & Rafikov 2001); beyond, the shock's jump
// decays as Rafikov's (2002) global solution has it for this disk (Sigma ∝ R^-1, c_s ∝ R^-1/4, Keplerian): dSigma/Sigma
// = 2 chi / ((gamma + 1) g(r)) with the N-wave's chi ∝ t^-1/2 (his eqs. 31-34), as |x - 1|^-WAKE_NO outside the orbit
// (0.69: 0.32 at 0.5 a, 0.20 at a) and |x - 1|^-WAKE_NI inside (0.82: 0.27 at 0.5 a), within 3% of that solution (near
// the planet both tend to the local form's -3/4: t ∝ |x - 1|^5/2 on top of the linear growth as |x - 1|^1/2). Exaggerated with the waves' emphasis (uWakeX = 1, the button "波を強調"):
// WAKE_A (3.5) decaying over WAKE_L (0.6 a), at most about 3 at the edge of the gap, so that the arms read as waves. (Round 8,
// the owner: "the waves' emphasis could be stronger": WAKE_A 3.5 -> 6.0, 1.7 times; the physical amplitude is unchanged.)
// The crest is a scale height wide, broadening as the wave travels (its shock widens), and widened further (and lowered, keeping its
// integral) where a texel or the pixel footprint across it is wider. It turns with the planet and grows and fades with
// it; from afar it is drawn weaker, as the gap is drawn shallower (uWake, see DEPTH in the script); inside the gap the
// planet's own disk takes over.
float wake1(vec4 pl, float R, float phi, float fp){
  float x = R / pl.x, HP = hP(pl.x);
  if (pl.w <= 0.0 || x < 0.42 || x > 2.5) return 0.0;
  float F = 4.8 - 4.0 * pow(x, -0.25) - 0.8 * pow(x, 1.25);
  float dphi = phi - pl.z - sign(x - 1.0) * F / HP;
  dphi = mod(dphi + PI, TAU) - PI;
  float sl = pow(x, 1.25) * abs(pow(x, -1.5) - 1.0) / HP, c = inversesqrt(1.0 + sl * sl);   // R dphi_w/dR, sin of the pitch
  float ax = abs(x - 1.0), w = H0 * pow(R, 1.25) * (1.0 + 0.5 * ax);
  float px = max(fp * R, 1.5 * R * (LNR_SPAN / uMapRes.x * sl + TAU / uMapRes.y) * c);   // footprint across the crest
  float wf2 = w * w + px * px, d = R * dphi * c;
  float amp = mix(WAKE_P * pow(max(ax, WAKE_X0) / WAKE_X0, x > 1.0 ? -WAKE_NO : -WAKE_NI), WAKE_A * exp(-ax / WAKE_L), uWakeX);
  return pl.w * amp * smoothstep(0.03, 0.10, ax) * smoothstep(0.42, 0.55, x) * (1.0 - smoothstep(2.0, 2.5, x))
       * w * inversesqrt(wf2) * exp(-d * d / wf2);
}
// (the planets' wakes add up)
float wake(float R, float phi, float fp){
  float s = 0.0;
  for (int i = 0; i < MAXP; i++) { if (i >= uNP) break; s += wake1(uPl[i], R, phi, fp); }
  return s;
}
// The streaks of the surface accretion (see ACC in the script): clumps form in the current layer and accrete (Mori, Bai &
// Tomida 2025 find them forming again and again on the accreting surface), sheared into arcs by the rotation and drifting
// inward with the flow, k c_s = k (H/R) R Omega, so a part of the pattern born at ln R_b is at ln R_b - k (H/R) Omega age.
// Two staggered generations living about ACC_LIFE / Omega (in bands, as turbL), one octave, faded below the pixel's
// footprint; a lognormal factor with mean 1 (the noise's standard deviation is 0.215), of contrast C (uAccC; Disk Lab v2:
// the layer is laminar, so with the symmetric wind its streaks are faint, ACC.C_SYM; the clumps that Mori, Bai & Tomida
// 2025 find form on the one-sided accreting surface, ACC.C_ASYM; it was 2.4 for both).
const vec2 ACC_CELLS = vec2(20.0, 9.0);
const float ACC_LIFE = 2.0;
float accTurb(float lnR, float phi, float Om, float fp, float drift, float seed, float ACC_TURB){
  // (lifetimes in bands four times apart, blended in radius, as in turbL: with a lifetime of exactly ACC_LIFE / Omega, as
  // until the seventh round, the generations' phases drifted out of step from one radius to the next as the clock ran,
  // making rings that were not carried by the flow: they moved outward, R / (1.5 t), and thinned)
  float b = log(ACC_LIFE / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b));
  float n = 0.0, w2 = 0.0, tilt = ACC_CELLS.x / TAU / TILT_PITCH;
  for (int j = 0; j < 2; j++) {
    float wb = j == 0 ? 1.0 - bf : bf;
    if (wb <= 0.0) continue;
    float band = floor(b) + float(j), T = uFpPeriod[int(band) + 5];
    for (int k = 0; k < 2; k++) {
      vec2 clock = fpPhase(band, k, 0.0); float c = clock.x, fc = clock.y, age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
      float kr = length(vec2(ACC_CELLS.x / TAU * 1.5 * Om * age + tilt, ACC_CELLS.y));
      vec2 q = vec2(ACC_CELLS.x / TAU * (phi - Om * age) + tilt * lnR,
                    ACC_CELLS.y * (lnR + drift * Om * age) + seed + 17.0 * floor(c) + 41.0 * float(k) + 29.0 * band);
      n += w * (1.0 - smoothstep(0.3, 0.7, kr * fp)) * vnoiseP(q, ACC_CELLS.x); w2 += w * w;
    }
  }
  float a = ACC_TURB * 0.215;
  return exp(ACC_TURB * n * inversesqrt(w2) - 0.5 * a * a);
}
void main(){
  float lnR = LNR_MIN + gl_FragCoord.x / uMapRes.x * LNR_SPAN;
  float phi = (gl_FragCoord.y / uMapRes.y - 0.5) * TAU;
  float R = exp(lnR), Om = OMEGA0 * exp(-1.5 * lnR), A = turbAmp(R);
  // pixel footprint in ln R at this point of the midplane; on an inclined disk it is stretched along the
  // line of sight
  vec2 P = R * vec2(cos(phi), sin(phi));
  vec3 d = vec3(P, 0.0) - uCam;
  float dist = length(d); vec3 rd = d / dist;
  float fp = dist * uPixA / R * (1.0 + (1.0 / max(abs(rd.z), 0.1) - 1.0) * abs(dot(P / R, normalize(rd.xy + 1e-6))));
  fp = max(fp, 3.0 * LNR_SPAN / uMapRes.x);
  // (the structure is only in the thermally ionized inner disk; its shadows reach out to twice its radius)
  vec3 n = A > 0.0 ? turb(lnR, phi, Om, fp, uSeed, true, 0.0, CELLS) * A : vec3(0.0);
  // cast shadows: the optical depth toward the star builds up mostly over the last part of the ray
  // (R' = t R, t from 0.5 to 1, weighted by the smooth profile), where the turbulence raises or lowers
  // the density. The surface behind a crest is shaded, behind a trough it is lit more strongly.
  float aR = LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R);
  float dtau = 0.0, rPrev = 1.0;
  if (turbAmp(0.5 * R) > 0.0) for (int k = 1; k <= 5; k++) {
    float t = 1.0 - 0.1 * float(k), tm = t + 0.05;
    float r = exp(-1.25 * log(t) - aR * (inversesqrt(t) - 1.0));          // tau*(t) / tau*(1) along the ray
    float At = turbAmp(R * tm);
    float f = At > 0.0 ? exp(1.6 * At * turb(lnR + log(tm), phi, Om * pow(tm, -1.5), fp, uSeed, false, 0.0, CELLS).x - 0.08 * At * At) : 1.0;
    dtau += (f - 1.0) * (rPrev - r); rPrev = r;
  }
  float nd = A > 0.0 ? turb(lnR, phi, Om, fp, uSeed + 11.0, false, 0.0, CELLS).x : 0.0;
  // the planet's wake raises the gas, the pebbles (which collect in its pressure crests, a little less) and, more, the
  // surface that faces the star; the raised crest shades the surface just outside it, so each arm is a bright crest
  // with a darker trough beyond
  float wk = wake(R, phi, fp);
  float sh = exp(-2.0 * max(0.0, wake(R - H0 * pow(R, 1.25), phi, fp) - wk));
  // gas density, skin brightness (slopes facing the star catch more light), pebble surface density, starlight on the
  // gap and beyond
  fragColor = vec4(exp(1.6 * n.x - 0.08 * A * A) * (1.0 + wk), max(0.0, 1.0 + 0.5 * n.y + RELIEF * n.z) * exp(-dtau) * (1.0 + 2.0 * wk) * sh,
                   max(0.0, 1.0 + A * nd) * (1.0 + 0.8 * wk), gapLight(R));
  // the accretion layers' streaks, upper and lower (independent patterns), where there are layers
  float hR = H0 * exp(0.25 * lnR);
  fragAcc = accAmp(R) > 0.0 ? vec4(accTurb(lnR, phi, Om, fp, uAccK.x * hR, uSeed + 61.0, uAccC.x), accTurb(lnR, phi, Om, fp, uAccK.y * hR, uSeed + 83.0, uAccC.y), 0.0, 0.0) : vec4(1.0);
}`;
  const WINDMAP_FS = `#version 300 es
precision highp float;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragVel;   // the gas velocity in units of v_K(r0): (v_R, v_phi, v_z), for the CO line
uniform vec2 uMapRes;
uniform float uAsymS;                    // the asymmetry's share of the dead zone's field now (ASYM_F times its fade)
${CONST_GLSL}
${FIELD_GLSL}
${MAP_GLSL}
void main(){
  // (both hemispheres: theta from -90 to 90 degrees; the lower one's lines bend as the side s says)
  float r = exp(LNW_MIN + gl_FragCoord.x / uMapRes.x * LNW_SPAN), th = (gl_FragCoord.y / uMapRes.y - 0.5) * PI;
  float R = r * cos(th), h = r * abs(sin(th)), s = th < 0.0 ? -uAsymS : uAsymS;
  float Rf = footRadius(R, h, s), zb = zBase(Rf), r0 = r0Of(Rf, s);
  float chi = (h - zb) / r0;             // height above the wind base in units of r0 (negative inside the disk)
  // Gas density of the wind, rho0(r0) ETA(chi) with rho0 = RHO_B r0^-3/2 (the self-similar form). ETA is
  // held at its value at CHI_C below that height, where the cold solution, starting from rest at the
  // surface, has it diverge; RHO_B puts that value at the density of the disk gas at its irradiation
  // surface (tau* = 1) at 1 au. Below the base the wind fades into the disk over WIND_BLEED. Lines only
  // carry gas where the disk has it (its inner edge, as Sigma, and the density cutoff at R_OUT). The wind
  // fades out toward the top and the side of the marched cylinder, so its edge does not show: exponentially from
  // 0.55 of the way (the display stretch is logarithmic for bright light, so a fade that only reaches zero at the edge
  // shows the edge as a hard line once the wind is bright, as in an outburst), and to zero over the last 15%.
  float lnrho = log(RHO_B) - 1.5 * log(r0) + tabAt(max(chi, CHI_C), Rf).w - ${G(+LNREF.toFixed(6))} + min(chi, 0.0) / WIND_BLEED - cutOut(r0)
              - 5.0 * smoothstep(0.55 * ZB, ZB, h) - 5.0 * smoothstep(0.55 * RB, RB, R)
              + log(max(smoothstep(R_IN * 0.8, R_IN * 1.3, r0) * (1.0 - smoothstep(0.85 * ZB, ZB, h)) * (1.0 - smoothstep(0.85 * RB, RB, R)), 1e-30));
  // ln r0, azimuth of the line relative to its foot, travel time of the gas from the base, ln density
  fragColor = vec4(log(r0), fieldRP(Rf, h, s).y, tabAt(max(chi, 0.0), Rf).z, lnrho);
  // the velocity along the line, v_K(r0) (F dxi/dchi, G, F) in (R, phi, z) above the base; below it the gas turns with
  // the disk (Keplerian at R)
  vec3 t = tabVAt(max(chi, 0.0), Rf).xyz;
  fragVel = chi > 0.0 ? vec4(t.x * t.z, t.y, t.x, 1.0) : vec4(0.0, sqrt(r0 / max(R, 1e-3)), 0.0, 0.0);   // (v_z: away from the midplane)
}`;
  // The wind's streamers (see windTurb): their cells (a few bundles around the disk and per unit ln r0), lifetime (in
  // units of the disk's) and contrast; WSTR_TAU, the travel time (in 1/Omega(r0)) their texture reaches (the table's
  // last row is 51.4)
  const WSTR_GLSL = `
const vec2 WIND_CELLS = vec2(5.0, 1.6);
// (Disk Lab v2, round 6: the contrast WIND_TURB 3.0 to 2.4, the owner's "a little calmer": the streamers' ln-density
// spread 1.03 to 0.82, one sigma a factor 2.8 to 2.3; the mean stays 1)
const float WIND_TURB = 2.4, WIND_LIFE = 3.0, WSTR_TAU = 52.0;
`;
  // The wind's streamers for this moment, drawn every frame into a volume texture on (ln r0, the azimuth of the foot
  // now, the travel time tau in 1/Omega(r0)), nb layers (travel times) per draw: the pattern turbL gives at the launch
  // (time uTime - tau/Omega) at the azimuth the foot had then (now less tau). As the pattern turns with the disk, the
  // launch azimuth and the turning since cancel, so it depends on the foot's azimuth now and, smoothly, on tau through
  // the generations' weights at the launch: a few layers per lifetime suffice, and the march reads it with one fetch
  // instead of evaluating the noise at each step.
  const WSTR_FS = (nb) => `#version 300 es
precision highp float;
${outs(nb)}
uniform vec3 uResW;
uniform float uLayer0;
uniform float uTime;
uniform float uSeed;
${CONST_GLSL}
${NOISE_GLSL}
${TURB_GLSL}
${MAP_GLSL}
${WSTR_GLSL}
void main(){
  float lnr0 = LNW_MIN + gl_FragCoord.x / uResW.x * LNW_SPAN, phi = (gl_FragCoord.y / uResW.y - 0.5) * TAU, Om = OMEGA0 * exp(-1.5 * lnr0);
  float v[${nb}];
  for (int k = 0; k < ${nb}; k++) {
    float tau = WSTR_TAU * (uLayer0 + float(k) + 0.5) / uResW.z;
    v[k] = turbL(lnr0, phi - tau, Om, 0.0, uSeed + 23.0, false, -tau / Om, WIND_CELLS, WIND_LIFE * LIFE).x;
  }
${Array.from({ length: nb }, (_, i) => `  o${i} = vec4(v[${i}]);`).join('\n')}
}`;
  // The eddies' volume texture (see CELLS3), drawn every frame on (ln R, φ, z/H) in two passes, nb layers (heights) per
  // draw, one to each colour attachment. TURB3_FS: the factor by which the eddies change the gas density (lognormal, mean
  // 1), faded where they are finer than a render pixel at that point (across them radially, in the sheared direction, or
  // vertically) or than about 1.5 texels, as the disk map fades its detail.
  const outs = (nb) => Array.from({ length: nb }, (_, i) => `layout(location = ${i}) out vec4 o${i};`).join('\n');
  const TURB3_FS = (nb) => `#version 300 es
precision highp float;
${outs(nb)}
uniform vec3 uRes3;       // texels along ln R, φ and z/H (-ZMAX3 to ZMAX3)
uniform float uLayer0;    // the first layer of this draw
uniform float uTime;
uniform float uSeed;
uniform vec3 uCam;
uniform float uPixA;      // angular size of a render pixel
${CONST_GLSL}
${NOISE_GLSL}
${TURB_GLSL}
${MAP_GLSL}
void main(){
  float lnR = LN3_MIN + gl_FragCoord.x / uRes3.x * LN3_SPAN, phi = (gl_FragCoord.y / uRes3.y - 0.5) * TAU;
  float R = exp(lnR), H = H0 * exp(1.25 * lnR), Om = OMEGA0 * exp(-1.5 * lnR);
  vec2 P = R * vec2(cos(phi), sin(phi));
  float zeta[${nb}], fpR[${nb}], fz[${nb}], n[${nb}], e[${nb}];
  for (int k = 0; k < ${nb}; k++) {
    zeta[k] = ZMAX3 * (2.0 * (uLayer0 + float(k) + 0.5) / uRes3.z - 1.0);
    float fp = length(vec3(P, zeta[k] * H) - uCam) * uPixA;   // the footprint of a pixel there (au)
    fpR[k] = max(fp / R, 1.5 * LN3_SPAN / uRes3.x);
    fz[k] = 1.0 - smoothstep(0.3, 0.7, CELLS3.z * max(fp / H, 3.0 * ZMAX3 / uRes3.z));
    n[k] = 0.0; e[k] = 0.0;
  }
  // the bands and generations of turb(), with the height as a third coordinate
  float b = log(LIFE / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b)), w2 = 0.0, tilt = CELLS3.x / TAU / TILT_PITCH;
  for (int j = 0; j < 2; j++) {
    float wb = j == 0 ? 1.0 - bf : bf;
    if (wb <= 0.0) continue;
    float band = floor(b) + float(j), T = uFpPeriod[int(band) + 5];
    for (int g = 0; g < 2; g++) {
      vec2 clock = fpPhase(band, g, 0.0); float c = clock.x;
      float fc = clock.y, age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
      float kr = length(vec2(CELLS3.x / TAU * 1.5 * Om * age + tilt, CELLS3.y));
      vec2 q = vec2(CELLS3.x / TAU * (phi - Om * age) + tilt * lnR, CELLS3.y * lnR + uSeed + 31.0 + 17.0 * floor(c) + 41.0 * float(g) + 29.0 * band);
      for (int k = 0; k < ${nb}; k++) {
        float a = (1.0 - smoothstep(0.3, 0.7, kr * fpR[k])) * fz[k];
        if (a > 0.0) { n[k] += w * a * vnoise3(vec3(q, CELLS3.z * zeta[k]), CELLS3.x); e[k] += w * w * a * a; }
      }
      w2 += w * w;
    }
  }
  float f[${nb}];
  for (int k = 0; k < ${nb}; k++) {
    float s = 1.6 * turb3Amp(R, zeta[k]);
    f[k] = exp(s * n[k] * inversesqrt(w2) - 0.0171 * s * s * e[k] / w2);   // mean 1 (the variance of vnoise3 is 0.0342)
  }
${Array.from({ length: nb }, (_, i) => `  o${i} = vec4(f[${i}]);`).join('\n')}
}`;
  // SHADE3_FS: the extra optical depth toward the star that the eddies add, relative to the smooth disk's, gathered along
  // the ray toward the star over its last part (R' = 0.6 R to R in eight steps of about an eddy, at the same angle above
  // the midplane, so z/H grows as (R'/R)^-1/4 inward as the disk flares), where most of it builds up near the
  // irradiation surface (as the disk map does for the structure that spans the column). Written next to the density
  // factor. At the surface a dense eddy adds only a sixth or so of its excess to tau* behind it (tau* grows e-fold over
  // about a third of the radius there, some seven eddies), so its shadow is long and faint.
  const SHADE3_FS = (nb) => `#version 300 es
precision highp float;
precision highp sampler3D;
${outs(nb)}
uniform vec3 uRes3;
uniform float uLayer0;
uniform sampler3D uT3;    // the density factor (TURB3_FS)
${CONST_GLSL}
${NOISE_GLSL}
${TURB_GLSL}
${MAP_GLSL}
const float SHADOW3 = 2.0;   // the shadows drawn twice as deep as the eddies make them, for the picture
void main(){
  float u = gl_FragCoord.x / uRes3.x, v = gl_FragCoord.y / uRes3.y, lnR = LN3_MIN + u * LN3_SPAN;
  float a0 = LNTAU1 - 1.25 * lnR - pow(exp(lnR) / R_OUT, P_OUT);   // ln tau* at the midplane
  vec2 o[${nb}];
  for (int k = 0; k < ${nb}; k++) {
    float w = (uLayer0 + float(k) + 0.5) / uRes3.z, zeta = ZMAX3 * (2.0 * w - 1.0), x = a0 - 0.5 * zeta * zeta;
    float g = 0.0;
    if (x > -5.0 && x < 4.0) {
      float rPrev = 1.0;
      for (int s = 1; s <= 8; s++) {
        float t = 1.0 - 0.05 * float(s), tm = t + 0.025;
        float r = exp(-1.25 * log(t) - 0.5 * zeta * zeta * (inversesqrt(t) - 1.0));   // tau*(t) / tau*(1) along the ray
        float fm = texture(uT3, vec3(u + log(tm) / LN3_SPAN, v, 0.5 + 0.5 * zeta * pow(tm, -0.25) / ZMAX3)).r;
        g += (fm - 1.0) * (rPrev - r); rPrev = r;
      }
    }
    o[k] = vec2(texture(uT3, vec3(u, v, w)).r, SHADOW3 * g);
  }
${Array.from({ length: nb }, (_, i) => `  o${i} = vec4(o[${i}], 0.0, 0.0);`).join('\n')}
}`;

  // The volume. Two programs are made from it: the usual one, and FULL (defined) with the slice and the planet seen
  // close up (and the envelope), which costs registers in the march even when unused; FULL is compiled in the
  // background and used only while one of those shows.  // The envelope map, drawn once on (ln r, θ) (θ the angle above the midplane): ln of the envelope's density (Ulrich
  // 1976, see ENV; 1 at r_c on the midplane far out), with the cavity along the axis and a fade at the outer edge, and
  // its column from the star (from 0.5 au) out to this point along the same direction, which dims the starlight.
  const ENV_GLSL = `
const float TH_CAV = ${G(+ENV.TH_CAV.toFixed(5))}, ENV_R = ${G(ENV.R)};
const float R_C = ${G(ENV.RC)};   // the centrifugal radius r_c: the disk's outer radius (ENV.RC = MODEL.R_OUT)
float cbrt(float v){ return sign(v) * pow(abs(v), 1.0 / 3.0); }
// cos theta0 of the streamline through the point at r (au), mu = cos of the polar angle: the root in [mu, 1] of
// m^3 + (x - 1) m - x mu = 0 with x = r / r_c (one real root for x > 1, Cardano; three for x < 1, the largest; then two
// Newton steps)
float envMu0(float r, float mu){
  float x = r / R_C;
  float pp = x - 1.0, q = -x * mu, D = 0.25 * q * q + pp * pp * pp / 27.0, m;
  if (D > 0.0) { float sD = sqrt(D); m = cbrt(-0.5 * q + sD) + cbrt(-0.5 * q - sD); }
  else { float pn = min(pp, -1e-6); m = 2.0 * sqrt(-pn / 3.0) * cos(acos(clamp(1.5 * q / pn * sqrt(-3.0 / pn), -1.0, 1.0)) / 3.0); }
  for (int i = 0; i < 2; i++) m -= (m * m * m + pp * m + q) / max(3.0 * m * m + pp, 1e-4);
  return clamp(m, max(mu, 1e-4), 1.0);
}
// ln of the density at r (au), mu = cos of the polar angle
float envLnRho(float r, float mu){
  float x = r / R_C, mu0 = envMu0(r, mu);   // x: r in units of r_c
  // density, with the pile-up where the streamlines meet at r_c on the midplane held finite
  float lnrho = -1.5 * log(x) - 0.5 * log(1.0 + mu / mu0) - log(max(mu / mu0 + 2.0 * mu0 * mu0 / x, 0.05));
  // the cavity: streamlines that start within TH_CAV of the axis are emptied (a little gas is left in it)
  float open = 1.0 - smoothstep(cos(TH_CAV + 0.08), cos(TH_CAV - 0.08), mu0);
  return lnrho + log(max(mix(0.015, 1.0, open) * (1.0 - smoothstep(0.65 * ENV_R, ENV_R, r)), 1e-30));
}
`;
  // (Disk Lab v2, round 8, the owner: "the background on and off, and a more realistic mode") The background: none (the
  // dark gradient alone), the sparse stars of before, or the sky of a star-forming region, as a young disk would have it
  // around: SKY_FS draws it once into an equirectangular map (BG.W x BG.H, on unit 16; drawn the first time it is asked
  // for) in the disk's frame, of radiance (rgb, added past the exposure as the stars are) and the cloud's transmission
  // toward the background (a, in V). A dark molecular cloud covers much of the sky (fBm of value noise on the sphere,
  // a large scale and filaments): A_V from 0.5 in its gaps to about 10 in its cores, reddening what shines through it
  // with the interstellar law (A_R : A_V : A_B = 0.75 : 1 : 1.32, R_V = 3.1; Cardelli, Clayton & Mathis 1989); behind
  // it the Milky Way's band, faint, on a great circle tilted to the disk, patchy with its own dust; where two bright
  // stars of the region light the cloud's edges (BG.LAMPS), the blue of a reflection nebula (as rho Ophiuchi's or
  // NGC 1333's); the cloud itself a little lighter than the gaps where it is thin and lit. Quiet by design: at most
  // about a tenth of white on the screen, so that the disk stays the subject. The point stars are the same as the
  // stars' background, reddened and dimmed by the cloud's transmission (most of them hidden), and the two lamps. In the
  // mid-infrared and millimetre looks the cloud's background shows the stars alone (its light is the visible's).
  // (LAMPS: direction, width in radians and strength of each nebula's light;
  // the first above and left of the first view's background, the second elsewhere. The band's pole is chosen so that it
  // crosses the first view's background low)
  // (Round 9, the owner: "a molecular cloud that looks the part would be good, but this one looks odd somehow". What was odd,
  // looked at in a port of this map to numpy (DESIGN.md, section 22): the cloud covered most of the sky at an A_V of about 3,
  // a soft, even veil that read as smoke or fog around the disk rather than a dark nebula; there were too few stars behind
  // it to show what it hides; the Milky Way came through as a brown plume; the reflection nebula was a dim grey rim. A dark
  // nebula is seen as the absence of a rich star field: black, ragged silhouettes with filaments across the Milky Way (the
  // Barnard clouds of Taurus, the Pipe and rho Ophiuchi's), stars reddened at their thin edges, a faint brownish glow of the
  // dust, and blue reflection nebulosity where a bright star sits by the dust. So the column is now mostly clear and
  // opaque past a threshold over a short range (G0, GW; A_V to AVMAX, with thin outskirts), its edges ragged with fine noise
  // and filaments; the band is smooth and creamy, the grain left to many faint stars (in the main shader, denser toward
  // it: starsIn); the reflection's dust is the smoother column (no filaments: a diffuse glow, not bright veins along the
  // edges), blue by a B star (LAMPS[0]) and yellow by a cool giant (LAMPS[1], as Antares's). LAMPS: direction, width
  // (rad), strength, colour.)
  const BG = { W: 2048, H: 1024, LAMPS: [[-0.62, 0.70, 0.02, 0.16, 1.0, 0.42, 0.60, 1.0], [0.55, -0.35, 0.76, 0.20, 0.6, 1.0, 0.80, 0.52]], MW: [0.943, 0.061, -0.328],
    G0: 0.55, GW: 0.42, AVMAX: 10, MODES: { off: 0, stars: 1, cloud: 2 } };
  const SKY_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uMapRes;
${NOISE_GLSL}
const float PI = 3.14159265;
float fbm(vec3 p, int oct){ float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { if (i >= oct) break; s += a * vnoise3(p, 1e6); p = p * 2.07 + vec3(1.7, -2.3, 0.9); a *= 0.5; } return s; }
void main(){
  vec2 uv = gl_FragCoord.xy / uMapRes;
  float lon = (uv.x - 0.5) * 2.0 * PI, lat = (uv.y - 0.5) * PI;
  vec3 d = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
  // the column: complexes some 20 to 40 degrees across, clumps in them, filaments (ridges) on their outskirts, wisps
  vec3 w = vec3(fbm(d * 1.7 + 11.0, 3), fbm(d * 1.7 + 23.0, 3), fbm(d * 1.7 + 37.0, 3));
  float big = fbm(d * 2.6 + 1.6 * w, 4), mid = fbm(d * 7.5 + 2.4 * w + 4.0, 5);
  float rid = 1.0 - abs(2.0 * fbm(d * 6.0 + 3.0 * w + 7.0, 5)), fine = fbm(d * 40.0 + 5.0 * w + 2.0, 3);
  float gs = 3.4 * big + 1.3 * mid, g = gs + 1.1 * (rid * rid - 0.35) * smoothstep(-0.3, 0.1, big) + 0.45 * fine;
  // mostly clear, opaque past G0 over GW, thin outskirts below it
  float e = smoothstep(${G(BG.G0)}, ${G(BG.G0 + BG.GW)}, g), o = smoothstep(${G(BG.G0 - 0.5)}, ${G(BG.G0)}, g);
  float Av = 0.06 + ${G(BG.AVMAX)} * pow(e, 1.5) + 0.6 * o * o;
  vec3 tr = exp(-0.921 * Av * vec3(0.75, 1.0, 1.32));   // (0.921 = ln 10 / 2.5; A_R : A_V : A_B, Cardelli et al. 1989)
  // the Milky Way behind it: a band, smooth and a little mottled
  vec3 ng = normalize(vec3(${BG.MW.join(', ')}));
  float b = dot(d, ng), mott = max(0.75 + 0.5 * fbm(d * 6.0 + 9.0, 4) + 0.25 * fbm(d * 30.0 + 1.0, 3), 0.0);
  float mw = (exp(-0.5 * b * b / 0.010) + 0.4 * exp(-0.5 * b * b / 0.07)) * mott;
  vec3 col = vec3(1.0, 0.86, 0.68) * 0.012 * mw * tr;
  // reflection nebulosity by the lamps, where there is dust (the smoother column), a little darkened by the opaque parts
  float dust = (1.0 - exp(-1.2 * smoothstep(${G(BG.G0 - 0.9)}, ${G(BG.G0 + 0.4)}, gs))) * (0.55 + 0.45 * exp(-0.15 * Av));
${BG.LAMPS.map(([x, y, z, sg, k, r, gg, bb]) => `  { float t = acos(clamp(dot(d, normalize(vec3(${x}, ${y}, ${z}))), -1.0, 1.0)); col += vec3(${r}, ${gg}, ${bb}) * ${(0.075 * k).toFixed(4)} * (exp(-0.5 * t * t / ${(sg * sg).toFixed(4)}) + 0.25 * exp(-t / ${(2.5 * sg).toFixed(3)})) * dust; }`).join('\n')}
  // the dust's own faint glow (the galaxy's light it scatters), brownish
  col += vec3(0.62, 0.50, 0.40) * 0.0016 * (1.0 - exp(-0.5 * Av)) * (0.5 + mw);
  fragColor = vec4(col, tr.g);
}`;
  const ENVMAP_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uMapRes;
${CONST_GLSL}
${MAP_GLSL}
${ENV_GLSL}
void main(){
  float lnr = LNE_MIN + gl_FragCoord.x / uMapRes.x * LNE_SPAN, mu = sin(gl_FragCoord.y / uMapRes.y * 0.5 * PI);
  // the column from 0.5 au, integrated in ln r (48 steps, trapezoid)
  float N = 0.0, f0 = exp(envLnRho(exp(LNE_MIN), mu) + LNE_MIN), dl = (lnr - LNE_MIN) / 48.0;
  for (int i = 1; i <= 48; i++) { float l = LNE_MIN + float(i) * dl, f1 = exp(envLnRho(exp(l), mu) + l); N += 0.5 * (f0 + f1) * dl; f0 = f1; }
  fragColor = vec4(envLnRho(exp(lnr), mu), N, 0.0, 0.0);
}`;
  // The envelope's streamers, in a volume texture made once (in idle time after the start, or when the envelope first
  // shows), on (ln r, φ, the signed angle above the midplane): the factor by which they change the density, and the
  // column from the star (from 0.5 au) out to the point along the same direction, with them, which dims the starlight
  // there, so that a dense streamer shades the envelope behind it. A streamer is a bundle of streamlines with nearby
  // launch directions far out (theta0, phi0): the parent cloud is clumpy, and the density along each streamline is set
  // by where it starts, so it is constant along it and the bundle shows as a filament that curves in onto the disk.
  // phi0 is phi less the azimuth swept on the way in: for the parabolic orbits of ENV, cos theta = cos theta0 cos alpha
  // (alpha the angle in the orbital plane from the start) and tan(phi - phi0) = tan alpha / sin theta0, a quarter turn
  // by the midplane (checked against an integration of the velocities). Accretion streamers like these are seen around
  // young protostars (e.g. Pineda et al. 2020). Lognormal with mean 1 over the launch directions (two octaves, variance
  // 0.0288); the cells (ENV_CELLS: around, and from the axis to the midplane) and the contrast are for the picture; the
  // two sides have streamers of their own.
  const ENV3_FS = (nb) => `#version 300 es
precision highp float;
${outs(nb)}
uniform vec3 uRes3;
uniform float uLayer0;
uniform float uSeed;
${CONST_GLSL}
${NOISE_GLSL}
${MAP_GLSL}
${ENV_GLSL}
const vec2 ENV_CELLS = vec2(12.0, 6.0);
const float ENV_TURB = 3.0;
float streamer(float r, float mu, float phi, float side){
  float mu0 = envMu0(r, mu), ca = clamp(mu / mu0, 0.0, 1.0), sa = sqrt(1.0 - ca * ca), s0 = sqrt(max(1.0 - mu0 * mu0, 0.0));
  float phi0 = phi - atan(sa, s0 * ca);
  vec2 q = vec2(phi0 / TAU * ENV_CELLS.x, acos(mu0) / (0.5 * PI) * ENV_CELLS.y + uSeed + (side > 0.0 ? 0.0 : 37.0));
  float n = 0.75 * vnoiseP(q, ENV_CELLS.x) + 0.25 * vnoiseP(2.0 * q + vec2(0.0, 5.3), 2.0 * ENV_CELLS.x);
  float sg = 1.6 * ENV_TURB;
  return exp(sg * n - 0.0144 * sg * sg);
}
void main(){
  float lnr = LNE_MIN + gl_FragCoord.x / uRes3.x * LNE_SPAN, phi = (gl_FragCoord.y / uRes3.y - 0.5) * TAU, dl = (lnr - LNE_MIN) / 32.0;
  vec2 o[${nb}];
  for (int k = 0; k < ${nb}; k++) {
    float th = (2.0 * (uLayer0 + float(k) + 0.5) / uRes3.z - 1.0) * 0.5 * PI, mu = sin(abs(th)), side = th < 0.0 ? -1.0 : 1.0;
    // the column with the streamers from 0.5 au, in ln r (32 steps, trapezoid)
    float N = 0.0, f0 = exp(envLnRho(exp(LNE_MIN), mu) + LNE_MIN) * streamer(exp(LNE_MIN), mu, phi, side);
    for (int i = 1; i <= 32; i++) { float l = LNE_MIN + float(i) * dl, f1 = exp(envLnRho(exp(l), mu) + l) * streamer(exp(l), mu, phi, side); N += 0.5 * (f0 + f1) * dl; f0 = f1; }
    o[k] = vec2(streamer(exp(lnr), mu, phi, side), N);
  }
${Array.from({ length: nb }, (_, i) => `  o${i} = vec4(o[${i}], 0.0, 0.0);`).join('\n')}
}`;

  // The CO line's transfer (see the CO line in FS), generated for Q groups of four velocities, with the arrays local
  // and the segment's update inline (passed to functions, the arrays would be copied in and out at every call):
  // coChannel for the channel map (one group: the channel's width) and coMoments (CO_Q groups, CO_N = 4 CO_Q velocities)
  const CO_Q = 6;
  // (round 9) A bound on each ray's work. A ray that grazes the inner disk's midplane (seen nearly edge-on from close by,
  // as the temperature's place, d 2.4 au at 6 degrees) met steps of 0.001 au (a quarter of the 0.004 au floor), halved up
  // to four times where the line-of-sight velocity sweeps by more than 4 % of the line width in a step (it does there all
  // along: 30 to 50 km/s of Kepler rotation against a width of 0.45 km/s), with the gas sampled two to five times a step:
  // tens of thousands of iterations, up to the loop's bound of 131072. A frame takes as long as its slowest ray, whatever
  // the scale: the moments took 196 ms at scale 0.12 and 428 at 0.25 on the M1 Max (a floor of some 130 ms), 536 ms at
  // 0.12 in a phone-sized frame, and a context was lost there (round 9). So from CO_IT[0] iterations on a ray the steps
  // are no longer halved, and from CO_IT[1] they lengthen, doubling every CO_IT[2]: a ray of a few hundred iterations (most
  // of them, face-on or from afar) is drawn as before, and the longest is held to about CO_IT[1] + 4 CO_IT[2]. (With uRayB
  // 0, box.diskRayBound(0), as before round 9, to compare.) With the march of round 9's end (rec, below) the bounds are a
  // sentinel only, about twice its slowest ray's iterations: [512, 1024, 256] (the march before rec) cost rec 0.8 % in M0
  // and 0.04 km/s in M1 on a ray across the gap (ver2/docs/gas-line-r10.md, 8.2).
  const CO_IT = [2048, 4096, 1024];
  // (round 9) The same for the continuum of the visible and mid-infrared looks (main, FS): marched in sixteenths of the
  // step until the transmission is under 1e-20, its slowest rays took some 60 ms on the M1 Max at any scale (a frame's
  // floor: 63 ms at scale 0.125 in a phone-sized frame, against 7 ms more at 0.25 and 105 more at 0.5). From CT_IT[0]
  // iterations the substeps halve every CT_IT[1] (to one, the step itself, at CT_IT[0] + 4 CT_IT[1]), and from CT_IT[2] the
  // steps lengthen, doubling every CT_IT[1].
  const CT_IT = [2048, 256, 3072];
  // (round 9, at its end: rec, the round-10 design's speed-ups that leave the physics as it is; ver2/docs/gas-line-r10.md,
  // 6.1 to 6.3 and 8.1 to 8.2, its prototype ver2/tools/gas-line-proto. With uCoRec 0, the march before them, to compare)
  //  - the refinement's test leaves out the total sweep of the velocity |du| / w: a velocity linear across a segment is
  //    integrated exactly by the erf profile; its curvature (the midpoint's offset), the density's and the source's
  //    changes (4 %, uMarch.w) stay. (The sweep's term was in the 2026-10-12 fix, its reason unrecorded.)
  //  - a segment starts from twice the step last accepted (at most the tier's fraction of the geometric step, uMarch.y,
  //    and not halved below 1/64 of it), not from that fraction each time: fewer samples tried again.
  //  - a group of four velocities all more than CO_SKIP widths outside the segment's sweep is not updated (its Gaussian's
  //    wings there are under 1e-8).
  // On the slowest ray of the prototype (edge-on close by, the moments) the gas samples went from 68891 to 3830 and the
  // groups' updates from 54616 to 1495, the errors against a march of 1/1024 of the step about 1e-4 in M0 and 0.001 km/s
  // in M1. coNIt, coNGas, coNGrp count a ray's iterations, gas samples and groups' updates (diskRayProbe).
  // (round 10a, dev.6: the loop's body on its own, shared by the march of Q groups drawn whole (CO_MARCH_GLSL) and the march of
  // one group that a kick resumes (CO_MARCHK_GLSL): hidden, what is done where every velocity is hidden)
  const CO_BODY = (Q, vq, hidden) => `    vec4 m4 = Tr[0];
    for (int q = 1; q < ${Q}; q++) m4 = max(m4, Tr[q]);
    if (max(max(m4.x, m4.y), max(m4.z, m4.w)) < 3e-4) ${hidden}   // (every velocity hidden)
    coNIt += 1.0;
    vec3 p = ro + rd * t;
    float R = max(length(p.xy), 0.05), Hs = H0 * pow(R, 1.25), az = abs(p.z);
    // (the steps as in the other looks, but lengthening smoothly above 4 to 5 scale heights instead of at once: a
    // sample crossing that height moved all the later ones, a seam in a refined still seen face-on)
    float geo = clamp(max(0.4 * Hs, mix(0.18, 0.25, smoothstep(4.0 * Hs, 5.0 * Hs, az)) * az), 0.004, max(0.4, 0.05 * length(p)));
    float ds = geo * uMarch.y;   // (a quarter of the geometric step; the cheaper march (MARCH) half of it)
    if (uCoRec > 0) ds = min(ds, 2.0 * dsP);   // (rec: from twice the step last accepted)
    if (uRayB > 0 && float(i) > uCoIt.y) ds *= exp2((float(i) - uCoIt.y) / uCoIt.z);   // (round 9: a long ray's later steps lengthen)
    if (i == 0) ds *= 0.25 + jitter;
    float tm = min(t + ds, b.y);
    vec3 pm = ro + rd * tm;
    vec4 g = coGas(pm, rd);
    // Test the endpoints and midpoint. Refine changes in CO density, source
    // temperature and velocity relative to the line width down to the verified
    // 1/64 geometry step. Eight widths select where finer sampling is useful;
    // outside that window the full profile is still integrated, never discarded.
    // CO_REFINE_BEGIN (also used by the isolated fixed-step comparison)
    for (int refine = 0; refine < 5; refine++) {
      if (refine >= int(uMarch.z) || (uRayB > 0 && float(i) >= uCoIt.x)) break;   // (round 9: no halving on a long ray)
      if (uCoRec > 0 && tm - t <= geo * 0.0156251) break;   // (rec: not below 1/64 of the geometric step)
      vec4 gm = coGas(ro + rd * (0.5 * (t + tm)), rd);
      float rhoMax = max(kP / K_CO, max(g.x, gm.x)), rhoMin = min(kP / K_CO, min(g.x, gm.x));
      float margin = 8.0 * max(wP, max(g.w, gm.w));
      float lo = min(uP, min(g.z, gm.z)) - margin, hi = max(uP, max(g.z, gm.z)) + margin;
      bool relevant = false;
      for (int q = 0; q < ${Q}; q++) {
        vec4 vv = ${vq};
        relevant = relevant || (any(greaterThanEqual(vv, vec4(lo))) && any(lessThanEqual(vv, vec4(hi))));
      }
      float change = 0.0;
      if (rhoMax > 0.0 && relevant) {
        change = max((rhoMax - rhoMin) / rhoMax, abs(g.y - sP) / max(g.y, sP));
        change = max(change, ((uCoRec > 0 ? 0.0 : abs(g.z - uP)) + 2.0 * abs(gm.z - 0.5 * (g.z + uP))) / min(wP, min(g.w, gm.w)));
      }
      if (change <= uMarch.w) break;   // (0.04; the cheaper march 0.12)
      tm = 0.5 * (t + tm); ds = tm - t; g = gm; pm = ro + rd * tm;
    }
    // CO_REFINE_END
    dsP = tm - t;
    float k = length(pm.xy) > MAG_RT * 0.9 ? K_CO * g.x : 0.0;
    if (tP < 0.0) { tP = tm; kP = k; sP = g.y; uP = g.z; wP = g.w; }
    // the segment from the previous sample to this one, in two parts where the pebble sheet lies between them (it
    // absorbs what lies behind it)
    float tc = tm;
    bool split = !sheetDone && tm >= tCross;
    if (split) { tc = max(tCross, tP); sheetDone = true; }
    float f = (tc - tP) / max(tm - tP, 1e-9);
    float kC = mix(kP, k, f), sC = mix(sP, g.y, f), uC = mix(uP, g.z, f), wC = mix(wP, g.w, f);
    for (int h = 0; h < 2; h++) {
      float L = tc - tP, kA = kP, kB = kC, sA = sP, sB = sC, uA = uP, uB = uC, w = 0.5 * (wP + wC);
      if (h == 1) {
        if (!split) break;
        vec3 c0 = vec3(0.0), tr0 = vec3(1.0);
        sheet(ro + rd * tCross, rd, c0, tr0);
        for (int q = 0; q < ${Q}; q++) Tr[q] *= tr0.r;
        L = tm - tc; kA = kC; kB = k; sA = sC; sB = g.y; uA = uC; uB = g.z; w = 0.5 * (wC + g.w);
      }
      // The log mean of the opacities. Small positive intervals must contribute:
      // a per-interval 1e-4 cutoff made finer marches lose weak CO emission.
      float kM = max(kA, kB);
      if (kM <= 0.0 || L <= 0.0) continue;
      float r = max(min(kA, kB), 1e-4 * kM) / kM, d0 = L * kM * (r > 0.999 ? 1.0 : (r - 1.0) / log(r));
      if (d0 <= 0.0) continue;
      // the profile: the Gaussian averaged over the sweep of velocities (erf), or where the sweep is narrower than two
      // line widths the Gaussian of the same area and variance. Retain the wings
      // as well as the core; individual weak segments can add visible intensity.
      float du = uB - uA, uM = 0.5 * (uA + uB), dS = sB - sA;
      bool wide = abs(du) > 2.0 * w;
      float g2 = w * w + du * du / 12.0, gk = w * inversesqrt(g2), ek = 0.70710678 / w, ak = 1.2533141 * w / (wide ? du : 1.0);
      float sLo = min(uA, uB) - CO_SKIP * w, sHi = max(uA, uB) + CO_SKIP * w;   // (rec: the groups beyond, skipped)
      for (int q = 0; q < ${Q}; q++) {
        vec4 vv = ${vq}, x = vv - uM;
        if (uCoRec > 0 && (vv.w < sLo || vv.x > sHi)) continue;   // (the four in ascending order)
        if (any(greaterThan(Tr[q], vec4(1e-4)))) {
          coNGrp += 1.0;
          vec4 dt = d0 * (wide ? ak * (erfA((vv - uA) * ek) - erfA((vv - uB) * ek)) : gk * exp(-0.5 * x * x / g2));
          vec4 e = exp(-dt), a = absorptionFraction(dt);
          // (the source linear in the optical depth across the part: the far end's share)
          vec4 fl = mix(a / max(dt, vec4(1e-9)) - e, dt * (0.5 - dt / 3.0), step(dt, vec4(1e-3)));
          I[q] += Tr[q] * (sA * a + dS * fl);
          Tr[q] *= e;
        }
      }
    }
    tP = tm; kP = k; sP = g.y; uP = g.z; wP = g.w;
    t = tm;
`;
  const CO_MARCH_GLSL = (name, Q, ret, args, vq, result) => `
${ret} ${name}(vec3 ro, vec3 rd, vec2 b, float tCross, float jitter, ${args}){
  // the intensities and transmissions at the velocities vq(q) (four in a group)
  vec4 I[${Q}], Tr[${Q}];
  for (int q = 0; q < ${Q}; q++) { I[q] = vec4(0.0); Tr[q] = vec4(1.0); }
  // the previous sample: where, opacity (per au), source (K), velocity (km/s), line width (km/s)
  vec4 gStart = coGas(ro + rd * b.x, rd);
  float t = b.x, tP = b.x, kP = length((ro + rd * b.x).xy) > MAG_RT * 0.9 ? K_CO * gStart.x : 0.0;
  float sP = gStart.y, uP = gStart.z, wP = gStart.w;
  bool sheetDone = tCross <= b.x || tCross >= b.y;
  float dsP = 1e9;   // (the step last accepted, see rec above)
  // The display's 150/300-step budget cut off bright CO before the emitting
  // gas was reached. This safety bound is checked for complete rays separately.
  for (int i = 0; i < 131072; i++) {
    if (t >= b.y || (uRayB > 0 && i >= 16384)) break;
${CO_BODY(Q, vq, 'break;')}  }
  ${result}
}`;
  // (round 10a, dev.6: THE GAS LINE IN KICKS (task C; see SPLIT). The march of one group of four velocities (the channel's, or one
  // group of the moments' in the cheaper tier, a pass each), resumable: its state the intensities and transmissions (8 numbers),
  // the march's place t, the step last accepted dsP (its sample before, tP, is t at the end of every step), the sample before's
  // opacity, source, velocity and width, the step's count and whether the pebble sheet is passed: 16 numbers, the state of the
  // march in kicks (four layers). budget, the steps it may take now; true when the ray is done. Drawn whole, the same function
  // with no bound: the picture the same in kicks, bit for bit)
  const CO_MARCHK_GLSL = `
bool coMarchK(vec3 ro, vec3 rd, vec2 b, float tCross, float jitter, vec4 vel, inout vec4 I0, inout vec4 Tr0, inout float t, inout float dsP, inout float kP, inout float sP, inout float uP, inout float wP, inout float iF, inout bool sheetDone, int budget){
  vec4 I[1], Tr[1];
  I[0] = I0; Tr[0] = Tr0;
  float tP = t;
  int i0 = int(iF), i = i0;
  bool fin = false;
  for (int n = 0; n < budget; n++) {
    i = i0 + n;
    if (i >= 131072 || t >= b.y || (uRayB > 0 && i >= 16384)) { fin = true; break; }
${CO_BODY(1, 'vel', '{ fin = true; break; }')}    i = i0 + n + 1;
  }
  I0 = I[0]; Tr0 = Tr[0]; iF = float(i);
  return fin;
}
// (its start: as the march drawn whole begins)
void coMarchK0(vec3 ro, vec3 rd, vec2 b, float tCross, out vec4 I0, out vec4 Tr0, out float t, out float dsP, out float kP, out float sP, out float uP, out float wP, out float iF, out bool sheetDone){
  vec4 gStart = coGas(ro + rd * b.x, rd);
  t = b.x; kP = length((ro + rd * b.x).xy) > MAG_RT * 0.9 ? K_CO * gStart.x : 0.0;
  sP = gStart.y; uP = gStart.z; wP = gStart.w;
  sheetDone = tCross <= b.x || tCross >= b.y;
  dsP = 1e9; I0 = vec4(0.0); Tr0 = vec4(1.0); iF = 0.0;
}`;
  const FS = `#version 300 es
precision highp float;
layout(location = 0) out vec4 fragColor;
// (round 10a) the volume's pixel this invocation draws: gl_FragCoord, but for a kick of the march in kicks (see SPLIT), which
// draws into its band's rows of the state, with the band's first row added (set at the start of main)
vec2 gFc = vec2(0.0);
const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);   // (the luminance's weights)
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCam;
uniform mat3 uBasis;
uniform float uTanHalf;
uniform float uRSnow;
uniform float uLum;     // the star's luminosity relative to its own (the outburst; round 7, see tempAt)
uniform float uExposure;
uniform float uStar;    // the star's glow relative to quiescence (an outburst brightens it)
// The look: 0 the model's quantities as they are (the gas and small grains filling the disk, translucent, in the
// colours of temperature); or as observed: 1 scattered light (optical and near-infrared: the disk is opaque, only its
// irradiated surface scatters starlight, more forward than back, so the near side is brighter and an edge-on disk
// shows a dark lane), 2 mid-infrared (the warm surface's own thermal emission, weighted by the Planck function at
// 10 microns, so the inner disk shines), 3 millimetre (the pebbles' thermal emission at the midplane, nearly thin,
// I ∝ T (1 - e^-tau); no scattered light, the gas transparent). The observed looks are drawn by the FULL program.
uniform int uLook;
uniform int uSteps;
uniform float uSeed;
uniform float uPx;      // render pixels per CSS pixel
uniform vec3 uJit;      // a still picture's frame: offset of the ray within the pixel (render pixels), of the march's jitter
uniform vec4 uClump[6];
uniform vec4 uVapor[4];
uniform int uMode;      // bit mask of the components drawn: 1 gas body, 2 surface skin, 4 pebble sheet, 8 wind
uniform vec4 uComp;     // their brightness as they fade in or out (gas, skin, pebbles, wind; 1 when on). A component
                        // turned off is absent: its absorption goes with its light (in every look)
// (Round 7, the owner: "with the gas off, the starlight should reach the envelope") A component turned off neither emits
// nor absorbs, and that includes the starlight it takes from the others. gasK: the share of the gas (with its dust, whose
// absorption it is: bit 2) in the starlight's optical depth tau* toward the wind and in the disk's shadow on the envelope,
// so that with the gas off the wind and the envelope are lit as if the disk were not there. gasL: the gas's own light,
// also that of the magnetosphere's inner gas disk and columns, which are gas. (The pebbles, a sheet at the midplane, cast
// no shadow beyond it, and their glow in the model look is their warmth; the planets' disks take no light from others.)
float gasK(){ return (uMode & 2) != 0 ? uComp.y : 0.0; }
float gasL(){ return (uMode & 1) != 0 ? uComp.x : 0.0; }
uniform float uMS;      // multiple scattering, approximate (on by default, a toggle; see MS_C), as it fades in or out
uniform float uLit;     // (round 8) the model's look lit by the star (see G_LIT): its strength for the quality of the moment
uniform float uFx;      // (round 8) the finish's strength for the quality of the moment (see FX in the script): 0 to 1
uniform float uFocus;   // (round 8) the camera's distance from the point looked at (for the depth's haze, see AIR)
// (Round 8, item 29) Depth: what lies far behind the point looked at is drawn a little fainter, as distance veils a view
// (an aerial perspective, a choice of the picture): from the point looked at to AIR_D times as far, down to 1 - AIR.
const float AIR = 0.3, AIR_D = 3.0;
float airK(float t){ return 1.0 - AIR * uFx * smoothstep(uFocus, AIR_D * uFocus, t); }
uniform sampler2D uDiskMap;
uniform sampler2D uAccMap;   // the accretion layers' streaks (upper, lower), on the disk map's grid
uniform vec2 uAcc;           // the accretion layers' strengths (upper, lower): with the wind's asymmetry only the lower
uniform vec2 uAccV;          // their inflow (upper, lower), in units of the sound speed (see ACC)
uniform sampler2D uWindMap;
uniform sampler2D uEnvMap;
uniform highp sampler3D uTurb3;   // the eddies (see CELLS3): density factor, extra optical depth toward the star
uniform float uEnv;     // the envelope: its visibility (it fades in with the distance of the camera)
uniform highp sampler3D uEnv3;   // the envelope's streamers: density factor, column toward the star (see ENV3_FS)
uniform highp sampler3D uWStr;   // the wind's streamers for this moment (see WSTR_FS)
uniform float uMag;      // the star's magnetosphere (see magLight): 1 within 1 au of the star, fading out by MAG.SHOW
uniform float uStarK;    // 1 over the automatic exposure's factor: the star and the magnetosphere keep their light (see AE in the script)
uniform vec3 uMagAxis;   // the dipole's axis now: tilted by MAG.TILT toward the azimuth the star has turned to
uniform vec3 uMagE1;     // the zero of the magnetic azimuth: toward the tilt, perpendicular to the axis
uniform float uMagT;     // the model's clock (modulo 600 s), for the columns' fluctuations
// The cutaway: the part of space toward the camera between two vertical planes through the star (containing the
// axis) is cut away, and the cut faces show a quantity in false colour (uSliceQ: 1 temperature, 2 gas density, 4 the
// regions of the coupling; Disk Lab v2, round 6: 0, the cut alone, and 3, the optical depth toward the star, are gone). One plane faces the camera (its normal the camera's horizontal
// direction uSliceN; uSliceR the horizontal direction to the right), the other is turned from it toward the right by
// 2 uCutA: with uCutA = 0 they coincide and half of space is cut away (the 1/2 cut, one face facing the viewer); with 45
// degrees the quarter in front on the right (the 1/4 cut: its right face seen face-on, the other along the line of
// sight, seen edge-on, the left half of the disk left whole); a change between them turns the second plane. uSliceZ scales
// heights on the faces (1: true proportions; a stretch would also need the march behind in stretched coordinates).
// uSliceOff: the planes' distance from the star toward the camera; they sweep in from the camera (or the edge of the
// drawn region, when the camera is farther) when the cut opens and back out when it closes. During the sweep the faces are the plain cut (the quantity's
// colours would make large flat walls of the chords through the outer disk); they fade in, by uSliceFace, as the
// planes reach the star. uSlice: 0 closed, 1 open.
uniform int uSlice;
uniform float uCutA;
uniform float uSliceOff;
uniform float uSliceFace;
uniform int uSliceQ;
uniform vec3 uSliceN;
uniform vec3 uSliceR;
uniform float uSliceZ;
${CONST_GLSL}
${PLANET_GLSL}
${FIELD_GLSL}
${SCATTER_GLSL}
${NOISE_GLSL}
${TURB_GLSL}
${MAP_GLSL}
// Absorbed fraction and the constant-source transfer integral. Optical depths
// are nonnegative. At tau <= 1, the degree-11 absorbed-fraction series has
// truncation error <= 1/12! = 2.09e-9, below float32 rounding. Moving the
// exponential branch to tau > 1 avoids cancellation near the old 0.01 join.
// The opaque threshold is ceil_float32(25 * ln(2)): exp(-tau) is then below
// half the spacing immediately below 1, so 1-exp(-tau) rounds to exactly 1.
// Keep exp(-tau) itself for transmission: faint obscured light still needs it.
const float TRANSFER_SERIES_TAU = 1.0, TRANSFER_OPAQUE_TAU = 17.32868;
float thinTransferWeight(float tau){
  // Horner form of sum(k=0..10, (-tau)^k / (k+1)!).
  float w = 1.0 / 39916800.0;
  w = -1.0 / 3628800.0 + tau * w;
  w = 1.0 / 362880.0 + tau * w;
  w = -1.0 / 40320.0 + tau * w;
  w = 1.0 / 5040.0 + tau * w;
  w = -1.0 / 720.0 + tau * w;
  w = 1.0 / 120.0 + tau * w;
  w = -1.0 / 24.0 + tau * w;
  w = 1.0 / 6.0 + tau * w;
  w = -0.5 + tau * w;
  return 1.0 + tau * w;
}
float absorptionFraction(float tau){
  if (tau <= TRANSFER_SERIES_TAU) return tau * thinTransferWeight(tau);
  if (tau >= TRANSFER_OPAQUE_TAU) return 1.0;
  return 1.0 - exp(-tau);
}
float transferWeight(float tau){
  if (tau <= TRANSFER_SERIES_TAU) return thinTransferWeight(tau); // exact limit 1 at zero
  return absorptionFraction(tau) / tau;
}
vec3 absorptionFraction(vec3 tau){ return vec3(absorptionFraction(tau.x), absorptionFraction(tau.y), absorptionFraction(tau.z)); }
vec4 absorptionFraction(vec4 tau){ return vec4(absorptionFraction(tau.x), absorptionFraction(tau.y), absorptionFraction(tau.z), absorptionFraction(tau.w)); }
vec3 transferWeight(vec3 tau){ return vec3(transferWeight(tau.x), transferWeight(tau.y), transferWeight(tau.z)); }
// Opacities are set for a translucent rendering (a real disk is opaque at visible wavelengths):
// gas with small grains (also in the wind), settled pebbles (opaque out to the edge of the disk, and their
// mostly thin millimetre-like emission).
const float K_G = 0.8, K_D = ${G(MODEL.K_D)}, K_MM = 40.0;
// Brightness of the components: the skin and the pebble layer per unit of absorbed starlight E (see Eabs). The gas
// body (gas mixed with small grains, which fills the disk) glows in proportion to its density, in the colour of its
// temperature, whatever the starlight: a picture of where the gas is rather than of what it emits. Where the gas is
// thick the glow saturates at G_GAS times the colour (emission over extinction), so the midplane shows as a band
// without hiding the surface and the snow line.
const float G_SKIN = 0.04, G_GAS = 0.2, G_DUST = 1.4;
// (Round 8, the owner: "even at a very high resolution the disk looks flat") The model's look lit by the star: the small
// grains at the flared surface scatter its light, strongly forward, as the visible look's do (one Henyey-Greenstein
// function, g = G_LIT_HG = 0.55: the near side of a disk at 50 degrees about 10 times brighter than the far one at the
// scattering angles 40 and 140 degrees, as in IM Lup's visible light, Pinte et al. 2008; disks' fitted g run 0.15-0.8),
// with the same starlight, its depth tau* and its shadows as the observed looks (the skin), in the disk's material colour
// lit (LIT_COL's mix toward the star's light). Inside, where the starlight does not reach (tau* >> 1), the gas's own glow
// is lowered by LIT_DARK, so the midplane and the far side, in the disk's own shadow, are darker. Not a surface glowing
// of itself (round 3): the light is the star's, on the matter it reaches; the glow of the rest stays.
const float G_LIT_HG = 0.55, G_LIT = 0.3, LIT_DARK = 0.6;
// the accretion layer's glow per unit of its density (relative to the gas body's G_GAS) and its colour (see ACC): a thin
// sheet (its column absorbs little) that glows, a picture of the flow
const float G_ACC = 7.0;
const vec3 ACC_COL = vec3(1.0, 0.50, 0.14);
// Multiple scattering, approximated as in two-stream diffusion (on by default, a toggle): of the starlight absorbed in
// the skin, a part MS_A comes out again as diffuse light (grains of albedo about one half), half of it going down into
// the disk, where it fades with the vertical optical depth from the surface, tau_v ≈ beta tau* (beta the grazing angle),
// as exp(-sqrt(3 (1 - albedo)) tau_v) = exp(-MS_C tau*). It is absorbed (and scattered toward the observer) in a second,
// softer layer about a scale height below the skin (tau* ~ 1/MS_C), integrated exactly as the skin is, isotropic, in the
// colour of the temperature there (turning from the surface's to the interior's). The shadows of the corrugation are
// softened in it. Not a solution of the transfer: a picture of light seeping into the disk below its lit surface.
const float MS_A = 0.5, MS_C = 0.04;
// Brightness of the wind per unit of its extinction (K_G rho) and of the starlight reaching it, chosen so
// that the wind's volume and its streamers (see windTurb) show from any side without veiling the disk: far brighter
// than its optical depth (about 1e-3) would make it next to the disk, a choice for the picture. Close to the disk
// (camera within about 22-68 au of the star) it is dimmed to WIND_NEAR, since there the paths through the wind near the
// star are long and its forward-scattered light would hide the amber of the irradiated surface. In the observed
// scattered light it keeps the earlier, fainter G_WIND_OBS (real images rarely show a wind at all). Its brightness also
// falls more slowly with height than its density, as (rho / rho_base)^(1 - WIND_RISE) with rho_base the density at the
// line's base (rho falls some sixtyfold by chi = 1 and fifteen-hundredfold by chi = 10): the outflow and its streamers
// show well above the disk, as a display choice like the softened falloff with distance (not in the observed looks).
// The extinction stays rho.
const float G_WIND = 450.0, WIND_NEAR = 0.35, G_WIND_OBS = 200.0, WIND_RISE = 0.15;
// The wind's asymmetry (an option, on by default; see opt.asym): with the field aligned with the rotation the wind is
// much weaker on one side, the side where the current layer and the surface accretion are (Mori, Bai & Tomida 2025:
// the mass-loss rate there an order of magnitude lower). uWindLow: the lower side's wind relative to the upper, WIND_LOW
// (0.1, the paper's order of magnitude in the mass-loss rate; 0.35 until the seventh round, a milder picture) or 1 for a
// symmetric wind, as it fades between them.
uniform float uWindLow;
float asymF(){ return clamp((1.0 - uWindLow) / ${G(1 - WIND_LOW_JS)}, 0.0, 1.0); }   // (round 8: the asymmetry's share, 0 to 1)
uniform float uPuffT;   // the wind's puffs (see puffFactor): their clock, the model's (s, modulo 1000 periods)
uniform float uPuff;    // and their strength: 1 in the model's look (fading in with it), 0 in the observed ones
const vec3 WIND_COL = vec3(0.30, 0.56, 1.0);  // blue: small grains scatter blue light more strongly
const float PILE = 0.5;                 // extra glow of the ice pile-up beyond its surface density
const float PEB_RING = ${G(PEB_RING)};   // (round 8) the pebbles' excess at a planet's pressure maximum, see PEB_RING in the script
const vec3 EXT = vec3(0.90, 0.97, 1.08); // small grains absorb blue light more strongly
const vec3 STARCOL = vec3(1.0, 0.87, 0.72);
// (round 8) the materials' colours in the model's look (linear; see MAT in the script): each material its own hue
uniform vec3 uMat[${MAT.length}];
${MAT.map((m, i) => `#define MAT_${m[0].toUpperCase()} uMat[${i}]`).join('\n')}
vec3 litCol(){ vec3 m = MAT_DISK / max(max(MAT_DISK.r, MAT_DISK.g), max(MAT_DISK.b, 1e-4)); return mix(m, vec3(1.0, 0.95, 0.88), 0.25); }   // (round 8: see G_LIT)
// the observed looks: the gas's opacity relative to K_G (the disk opaque in scattered light and the mid-infrared), the
// colour of scattered starlight, the forward scattering of the grains at the surface, and the gains of each look
const float OPT_K = 30.0, MIR_K = 8.0, G_OPT_HG = 0.55, G_OPT = 1.0, G_MIR = 2.5, G_MM = 0.3;
const vec3 SCAT_COL = vec3(1.0, 0.94, 0.86);
// mid-infrared: B_nu(10 microns, T) relative to 300 K, softly capped, and a thermal palette (red to pale yellow)
float mirPlanck(float T){ float b = (exp(1439.0 / 300.0) - 1.0) / (exp(1439.0 / max(T, 20.0)) - 1.0); return b / (1.0 + b / 6.0); }
vec3 mirColor(float T){ return mix(vec3(0.85, 0.16, 0.06), vec3(1.0, 0.86, 0.55), smoothstep(150.0, 700.0, T)); }
// millimetre: one warm hue; the stretch turns the bright parts toward white (like the 'afmhot' maps of ALMA images)
const vec3 MM_COL = vec3(1.0, 0.42, 0.12);
// The envelope scatters starlight like the wind (small grains, forward scattering, bluish), with a softened falloff
// with the distance from the star (about 15 au). Starlight does not reach it within the angle of the disk's surface
// seen from the star (z/R below about 0.16): the disk's shadow. Elsewhere it is dimmed by the envelope's own column
// toward the star (ENV_KSTAR per unit of the map's column, so that it reaches some tens of au into the envelope next to
// the cavity and less toward the midplane): the cavity's walls are lit, as in images of young stars still in their
// envelopes. The density and the column include the streamers (see ENV3_FS), so a dense streamer is brighter where the
// light reaches it and shades the envelope behind it, outward from the star: the light comes out through the gaps
// between them in shafts that fan out from the star. Seen along the line of sight it is kept translucent, as the disk
// is: its density is scaled by ENV_RHO relative to the gas density unit of the disk (the midplane at 1 au) and it
// absorbs little. envLight returns the emission and the extinction per unit length, the same inside the marched
// cylinder and outside it.
// (the map's column is in au, so both scale as 1 / r_c: 8 au to the sixth round, 30 au since; with r_c = 30 au, 1.07e-4
// and 0.133, written here as the products with r_c so that they follow it, ENV.RC)
const float ENV_RHO = ${G(3.21e-3 / ENV.RC)}, G_ENV = 70.0, ENV_KSTAR = ${G(3.99 / ENV.RC)};
const vec3 ENV_COL = vec3(0.55, 0.66, 0.95);
// (Round 7, the owner: "as this shows the model, matter should glow somewhat of itself") In the model's look the envelope
// also glows with its density, in the colour of its temperature, whatever the starlight, as the disk's gas does (G_GAS):
// its midplane, densest but in the disk's shadow and its own, shows. Its temperature is that of small grains in the
// star's light at r (tSurf's law: 93 K at 100 au, 49 K at 500 au; where the envelope shades itself it is cooler, which
// this leaves out). ENV_SELF, relative to the lit part's G_ENV, chosen by eye (DESIGN.md, section 17). Density only, not
// a weight by temperature, so that no lit surface stands out as a sheet (round 3).
const float ENV_SELF = 3.0;
vec3 tcolor(float T);   // (defined below, with the temperature palette)
const int ENV_N = 40;                   // samples of the envelope in front of and behind the marched cylinder
void envLight(vec3 p, vec3 rd, out vec3 em, out vec3 ex){
  float r = max(length(p), 0.5), R = length(p.xy), lr = (log(r) - LNE_MIN) / LNE_SPAN, th = atan(p.z, R);
  float m = texture(uEnvMap, vec2(lr, abs(th) / (0.5 * PI))).r;
  vec2 st = texture(uEnv3, vec3(lr, atan(p.y, p.x) / TAU + 0.5, th / PI + 0.5)).rg;   // the streamers: density factor, column
  float re = ENV_RHO * uEnv * exp(m) * st.x;
  em = G_ENV * K_G * re * mix(1.0, smoothstep(0.13, 0.2, abs(p.z) / max(R, 1e-3)), gasK()) * exp(-ENV_KSTAR * st.y) / (1.0 + r * r / 3164.0) * phaseGas(dot(p, -rd) / r) * (uLook == 0 ? MAT_ENV : ENV_COL);
  if (uLook == 0) em += ENV_SELF * K_G * re * MAT_ENV;   // (round 8: its material's colour, no longer its temperature's)
  ex = K_G * re * EXT;
}

// the disk map at (ln R, φ): factors of the gas density, the skin brightness, the pebble density and the starlight
vec4 diskMap(float lnR, float phi){ return texture(uDiskMap, vec2((lnR - LNR_MIN) / LNR_SPAN, phi / TAU + 0.5)); }
// the eddies at (ln R, φ, z/H): the factor of the gas density, and the extra optical depth toward the star that they add
// relative to the smooth disk's (none beyond ZMAX3 scale heights, nor beyond the inner disk the texture covers)
vec2 eddies(float lnR, float phi, float zh){
  float u = (lnR - LN3_MIN) / LN3_SPAN;
  if (abs(zh) >= ZMAX3 || u >= 1.0) return vec2(1.0, 0.0);
  return texture(uTurb3, vec3(u, phi / TAU + 0.5, 0.5 + 0.5 * zh / ZMAX3)).rg;
}
// the wind map at (R, z) (both hemispheres, which differ with the asymmetry): ln of the radius r0 where the field line
// leaves the disk, its azimuth relative to the foot, the travel time of the gas from the base, ln of the gas density
vec4 windMap(float R, float z){
  return texture(uWindMap, vec2((0.5 * log(R * R + z * z) - LNW_MIN) / LNW_SPAN, 0.5 + atan(z, R) / PI));
}
// The disk ends in a density cutoff at R_OUT (exp(-(R/R_OUT)^P_OUT)); its tapering edge lies in the shadow of
// the flared disk, so the light fades with the surface.
float Sigma(float R, float lnR){ return exp(-lnR - cutOut(R) + gapLn(R)) * smoothstep(R_IN * 0.8, R_IN * 1.3, R); }
// Starlight absorbed per unit area of the surface, L β / 4πR², with β the grazing angle of the
// irradiation surface z_s = H sqrt(2 a), a = ln τ* at the midplane. Where the density cutoff brings the
// surface down, β drops to zero: the edge lies in the shadow of the disk's crest. Shown with the true
// R^-2 falloff inside 1 au, easing to R^-1.1 outside and to R^-0.2 beyond OUTER_R = 6 au (scattered-light images are
// often scaled by R² for the same reason; the disk reaches 30 au, so its outer part would otherwise be lost in the dark).
const float OUTER_R = 6.0, OUTER_E = 0.9;
// With the planet's gap the starlight is redistributed: the inner rim shades the gap, and the light that passes over
// it falls on the outer wall and beyond. That factor comes from ray tracing (the disk map's fourth channel).
float litFall(float R){ return pow(1.0 + R, 0.9) / (0.66 * (R * R + 0.01)) * pow(max(R / OUTER_R, 1.0), OUTER_E); }   // (its fall with R)
const float LIT_F1 = 2.7994;   // (litFall(1 au))
float Eabs(float R, float lnR, float H){
  float cut = cutOut(R), a = max(LNTAU1 - 1.25 * lnR - cut, 1.0);
  float beta = max(H * sqrt(2.0 * a) / R * (0.25 - (0.625 + 0.5 * P_OUT * cut) / a), 0.0) + 0.004 / R;
  return beta / 0.022 * litFall(R) * smoothstep(R_IN * 0.85, R_IN * 1.5, R);
}

// (Disk Lab v2: the hot end turned from warm white to yellow through gold, and the ice's edge from cream to white, so
// that 160 K and 2000 K no longer look alike: blue, white at the snow line, orange, gold, yellow.)
// Temperature palette (linear RGB; the stops are chosen in display space): blue below the water-ice
// temperature, pale at it, then amber, gold and warm white toward dust sublimation. Hue carries
// temperature; brightness comes from the energy budget.
vec3 tcolor(float T){
  float l = log(T);
  vec3 c = vec3(0.023, 0.148, 0.893);                                     // 40 K
  c = mix(c, vec3(0.071, 0.325, 1.000), smoothstep(3.69, 4.50, l));      // 90 K
  c = mix(c, vec3(0.560, 0.800, 1.000), smoothstep(4.50, 4.98, l));      // 145 K
  c = mix(c, vec3(0.920, 0.900, 0.860), smoothstep(4.98, 5.16, l));      // 175 K (Disk Lab v2: white, the ice's edge)
  c = mix(c, vec3(1.000, 0.325, 0.047), smoothstep(5.16, 5.86, l));      // 350 K
  c = mix(c, vec3(1.000, 0.560, 0.120), smoothstep(5.86, 6.68, l));      // 800 K (Disk Lab v2: gold)
  c = mix(c, vec3(1.000, 0.860, 0.240), smoothstep(6.68, 7.38, l));      // 1600 K (Disk Lab v2: yellow, not white)
  return c;
}
// (Round 6's tVert, a cos^4 rise from the midplane's power law to 2.8 times it at the irradiation surface, Dartois et al.
// 2003's form, is replaced in round 7 by tempAt below: see THERMO in the script.)

vec2 boundsCylRZ(vec3 ro, vec3 rd, float rb, float zb){
  float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - rb * rb;
  float t0 = -1e9, t1 = 1e9;
  if (a > 1e-6) { float d = b * b - a * c; if (d < 0.0) return vec2(1.0, 0.0); float s = sqrt(d); t0 = (-b - s) / a; t1 = (-b + s) / a; }
  else if (c > 0.0) return vec2(1.0, 0.0);
  if (abs(rd.z) > 1e-6) { float ta = (-zb - ro.z) / rd.z, tb = (zb - ro.z) / rd.z; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (abs(ro.z) > zb) return vec2(1.0, 0.0);
  return vec2(max(t0, 0.0), t1);
}
vec2 boundsCyl(vec3 ro, vec3 rd){ return boundsCylRZ(ro, rd, RB, ZB); }

// Behind the inner rim of a planet's gap the ray toward the star crosses the rim's surface layers, so tau* there is
// at least that of the rim at the same angle above the midplane (the starlight below the rim's surface is absorbed at
// the rim): ln tau* = max(local, rim). uPlRim[i]: the rim's radius and its angle z/R seen from the star, the radius
// where the outer wall comes out of its shadow, and H/R at the rim (a radius of 1e9 when the gap is too shallow to
// cast a shadow). Ray tracing the same gas puts the surface (tau* = 1) across the gap within 3% of this angle. The wind's
// light and the slice take it. (Each planet's rim in turn, over its own stretch.)
float xRim(float R, float az, float x){
  float th = az / R;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNP) break;
    vec4 r = uPlRim[i];
    if (R <= r.x || R > r.z + 0.5) continue;
    float xr = 0.5 * (r.y * r.y - th * th) / (r.w * r.w);
    x = mix(x, max(x, xr), 1.0 - smoothstep(r.z, r.z + 0.5, R));
  }
  return x;
}
// x = ln of the optical depth toward the star; the irradiation surface is x = 0
float lnTauStar(vec3 p){
  float R = max(length(p.xy), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR);
  return clamp(LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R) - 0.5 * p.z * p.z / (H * H), -30.0, 30.0);
}

// Streamers in the wind: how much gas a bundle of field lines lifts (the mass loading) varies with the place and the
// time of the launch: the surface is laminar, but the launch is not steady (in the simulations the surface flows and the
// wind vary over about an orbit). That variation is given as a pattern on the surface that changes slowly (the noise
// of the turbulent structure, with lifetimes WIND_LIFE times longer), so the gas launched under the same pattern
// carries the same loading: each bundle of lines becomes a streamer that rises and turns with its lines, with clumps
// moving along it at the flow speed where the loading changes; streamers are replaced as the pattern is (finite
// lifetimes, so they do not wind up). For the picture the cells are large (WIND_CELLS: a few bundles around the disk and per unit ln r0)
// and the contrast WIND_TURB is the same at every radius. q = (ln r0, azimuth of the foot at the launch, travel time
// in 1/Omega(r0)); dq is how far q moved over the last step of the march: structure finer than a step is faded, so
// that it does not turn into noise. Lognormal with mean 1.
${WSTR_GLSL}
// steps of the march above the disk where the wind is brighter than WIND_FINE (relative to the height, and at most in
// au, or 0.03 of the distance from the star beyond that; elsewhere 0.25 and 0.4, or 0.05 of the distance)
const float WIND_DS = 0.12, WIND_DSMAX = 0.25, WIND_FINE = 1e-3;
const float FAR_K = 4.0;   // (round 8: the wind's steps far behind a close view, see the march)
// (round 8: beyond the cylinder of before, where the wind has been drawn since, longer: from 0.03 of the distance at 30 au
// to 0.05 at 60 au. Its streamers there are a few au across and faint; the frame of the whole disk took 20 % longer with
// 0.03 everywhere)
float windDs(float rr){ return rr * mix(0.03, 0.05, smoothstep(30.0, 60.0, rr)); }
// the streamers' radial wavenumber once sheared (as in turb, on average over a lifetime: Ω age ≈ 0.75 WIND_LIFE LIFE)
const float WIND_KR = length(vec2(WIND_CELLS.x / TAU * (1.125 * WIND_LIFE * LIFE + 1.0 / TILT_PITCH), WIND_CELLS.y));
// The wind's puffs (round 8): intermittent launches carried with the gas, so that the wind shows leaving the disk and
// flowing out without marks. Each bundle of lines (a cell of PUFF_CELLS around the disk and per unit ln r0, in the disk's
// frame at the moment of the launch) launches every PUFF_P s of the clock at its own phase, a share PUFF_SHARE of them each
// time, a puff lasting PUFF_DUTY of the period (a Gaussian in the launch time) and filling its cell as a smooth blob: it is
// born at the base, bright, and rides up the lines. Its light is the wind's times 1 + PUFF_A g, and as the
// wind thins it keeps more of its brightness than the gas around it, (rho_base / rho)^PUFF_KEEP (at most 12), fading with
// the travel time (PUFF_TAU, in 1/Omega(r0)); the gas between the puffs is a little fainter, so that the mean is kept. The
// puffs ride the lines k times faster than the gas, a display factor, k = PUFF_K (r0 / 1 au)^1.5 up to PUFF_KMAX: the
// wind's own time scale is the orbit at r0 (12 s at 1 au, 6 minutes at 10 au on the model's clock), so the outer wind
// would hardly move on the screen; with the factor every radius flows in about the same time (inside 7.4 au a puff
// rides, per launch period, as far along its line as the gas does in half an orbit at r0). Faded where the march's steps
// do not resolve them, and not drawn where the gas is nearer the camera than the star (seen from inside the wind, they
// would sweep across the whole picture). In the model's look only.
// (Tried in the eighth round, see the notes: shells in step across the disk, arcs, pulses on the streamers, puffs of
// other sizes, contrasts and speeds; this form is the one that reads as an outflow in the usual and edge-on views.)
const vec2 PUFF_CELLS = vec2(10.0, 4.0);
// Keep the outward motion visible with gentler brightness changes (PUFF_A 5 to 3.5; Disk Lab v2, round 6: to 2.8, the
// owner's "a little calmer", a puff 3.8 times the wind around it at its base instead of 4.5).
const float PUFF_P = ${G(PUFF.P)}, PUFF_DUTY = 0.25, PUFF_A = 2.8, PUFF_KEEP = 0.3, PUFF_TAU = 30.0, PUFF_SHARE = 0.2;
const float PUFF_K = 3.0, PUFF_KMAX = 60.0;
float puffFactor(vec3 q, vec3 dq, float lr, float pc){
  if (uPuff <= 0.0) return 1.0;
  float near = smoothstep(0.4, 1.0, pc);   // (none nearer the camera than the star: pc, the distance from the camera over that from the star)
  if (near <= 0.0) return 1.0;
  // W = Omega(r0) k, the rate of the travel time at which the puffs ride (k = PUFF_K (r0 / 1 au)^1.5 up to PUFF_KMAX)
  float lnr0 = q.x, tau = max(q.z, 0.0), ir15 = exp(-1.5 * lnr0), W = OMEGA0 * clamp(PUFF_K, ir15, PUFF_KMAX * ir15), tW = tau / W;
  // the steps' resolution: across the bundles (in ln r0 and, at the foot's azimuth at the launch, around) and along the
  // lines (a puff spans W PUFF_P PUFF_DUTY of the travel time)
  float kr = max(max(PUFF_CELLS.y * dq.x, PUFF_CELLS.x / TAU * (dq.y + dq.z)), dq.z / (W * PUFF_P * PUFF_DUTY));
  float fr = 1.0 - smoothstep(0.35, 0.7, kr);
  if (fr <= 0.0) return 1.0;
  float s = (uPuffT - tW) / PUFF_P;                          // launches since the clock's zero, at this gas's puff's launch
  float phiL = q.y + q.z - OMEGA0 * ir15 * tW;               // the foot's azimuth at that launch (it turned tau / k since)
  // one blob per bundle: a smooth window in its cell (1 in the middle, 0 at the edges), its own phase (a hash of the
  // cell), and whether it puffs at each launch (a share PUFF_SHARE of them: the golden ratio's sequence from its own start)
  vec2 c = vec2(phiL / TAU * PUFF_CELLS.x, lnr0 * PUFF_CELLS.y), ci = floor(c), cf = c - ci;
  ci.x = mod(ci.x, PUFF_CELLS.x);
  float h = hash12(ci + 0.37), x = fract(s + h), n = floor(s + h);
  vec2 wv = 4.0 * cf * (1.0 - cf);
  float mask = wv.x * wv.y * step(fract(7.0 * h + 0.618034 * n), PUFF_SHARE);
  float u = (x - 0.5) / (0.5 * PUFF_DUTY), g = exp(-0.5 * u * u);
  // (the brightness kept at most 12 times, e^2.485)
  float a0 = uPuff * near * fr * PUFF_A * exp(min(-PUFF_KEEP * min(lr, 0.0), 2.485) - tau / PUFF_TAU);
  return (1.0 + a0 * mask * g) / (1.0 + a0 * PUFF_SHARE * 0.444 * 1.2533 * PUFF_DUTY);   // (the means: the window's 4/9, the pulse's sigma sqrt(2 pi))
}
float windTurb(vec3 q, vec3 dq, float lr, float pc){
  float pf = puffFactor(q, dq, lr, pc);   // (lr: ln of the density relative to the line's base)
  float k = max(max(WIND_KR * dq.x, WIND_CELLS.x / TAU * dq.y), dq.z / (WIND_LIFE * LIFE));   // cells crossed per step
  float f = 1.0 - smoothstep(0.3, 0.6, k);
  if (f <= 0.0) return pf;
  // the pattern from the streamers' texture, at the azimuth of the foot now (q.y + q.z: the foot has turned by q.z since)
  float n = texture(uWStr, vec3((q.x - LNW_MIN) / LNW_SPAN, (q.y + q.z) / TAU + 0.5, q.z / WSTR_TAU)).r;
  return pf * exp(f * 1.6 * WIND_TURB * n - 0.059 * WIND_TURB * WIND_TURB * f * f);
}

// the length (in au of path) that a step from height z0 to z1 (in units of H; dzh = z1 - z0) spends in a Gaussian layer
// centred at za, ACC_W wide, weighted by the profile: the integral of exp(-u^2/2) over the step, with erf approximated
// (Winitzki 2008, to about 1e-3)
float erfA(float x){ float x2 = x * x, a = 0.147; return sign(x) * sqrt(1.0 - exp(-x2 * (1.2732395 + a * x2) / (1.0 + a * x2))); }
const float ACC_REACH = 4.0 * ACC_W;   // (round 8: beyond it a layer's column over a step is under 3e-4 of its peak)
float accColumn(float z0, float z1, float za, float ds, float dzh){
  float u1 = (z1 - za) / ACC_W;
  if (abs(dzh) < 0.05 * ACC_W) return exp(-0.5 * u1 * u1) * ds;
  float u0 = (z0 - za) / ACC_W;
  return ds / abs(dzh) * ACC_W * 1.2533141 * abs(erfA(u1 * 0.70710678) - erfA(u0 * 0.70710678));
}
// (Round 7) The temperature at R, z/H = zh, where ln tau* = x (see THERMO in the script): the interior's T^4 from the
// reprocessed starlight and the accretion heating, laminar (flat below the accretion layer, falling above it with the
// column) or turbulent (falling with height from the midplane), and the grains above it superheated in the starlight that
// reaches them; held below the dust's sublimation. The colour of the model's look, the temperature's cut face (its snow
// line, the 160 K surface), the pebbles' ice and the observed looks' temperatures take it.
// The interior comes from a table (uThermo, made in the script, see thermoTable: 512 radii uniform in ln R from 0.02 to
// 40 au by 128 heights |z| from 0 to 8 H, half floats, read with the GPU's linear filter): r, T_acc (the accretion's part,
// laminar or turbulent, with the floor) and g, T_i (the reprocessed starlight's, for the star's own luminosity; it scales
// as uLum^1/4). Evaluated at every sample of the march, the expressions themselves cost about as much again as the rest of
// the disk's sample (the snow line's view took twice the GPU time); from the table, with the superheated term only where
// tau* < 20 and the sublimation's cap only above 900 K, a few per cent.
uniform highp sampler2D uThermo;
const float TT_LN0 = ${G(+Math.log(0.02).toFixed(6))}, TT_DLN = ${G(+(Math.log(2000) / 511).toFixed(8))};
float tInt4(float lnR, float zh){
  vec2 t = texture(uThermo, vec2((0.5 + (lnR - TT_LN0) / TT_DLN) / 512.0, (0.5 + min(abs(zh), 8.0) * ${G(127 / 8)}) / 128.0)).rg;
  t *= t; t *= t;
  return t.y * uLum + t.x;
}
float subCap(float T){ if (T <= 900.0) return T; float r = T / TH_TSUB; r *= r; r *= r; return T * inversesqrt(sqrt(sqrt(1.0 + r * r))); }   // (the dust's sublimation, soft: T (1 + (T/T_SUB)^8)^-1/8)
float tempAt(float R, float lnR, float zh, float x){
  float t4 = tInt4(lnR, zh);
  // (below tau* = 20 the superheated term is under e^-20 of T_ds^5: nothing)
  return subCap(x > 3.0 ? sqrt(sqrt(t4)) : pow(t4 * sqrt(sqrt(t4)) + TH_KDS5 * uLum * exp(-2.0 * lnR - exp(x)), 0.2));
}
float tMid(float R, float lnR){ return subCap(sqrt(sqrt(tInt4(lnR, 0.0)))); }
float tSurf(float R){ return subCap(pow(TH_KDS5 * uLum / (R * R), 0.2)); }   // the superheated grains in full starlight
#ifdef FULL
// in the part cut away the disk is left out (gDiskOff, see cutWind): its gas, its lit surface, the accretion layers and
// the vapour; the wind and the envelope stay
bool gDiskOff = false;
#endif
// (round 8) The envelope is drawn by both programs (it was the FULL program's): since round 8 it shows, faintly, from
// 40 au away, at the whole disk's view, which the FULL program took from 22 to 68 ms of GPU time at scale 0.5 (its other
// paths cost the march even unused). Inside the cylinder it is sampled about every envStep(r) along the ray rather than at
// every step of the march (it is smooth on that scale): gEnvAcc, the length marched since it was last sampled; at a
// sample its emission and extinction stand for that whole length
float gEnvAcc = 0.0;
float envStep(float r){ return max(1.5, 0.08 * r); }
// (round 10a) The march in kicks (SPLIT in the script; DESIGN.md, section 23): the work a step of each loop counts against a
// kick's budget, in steps of the march (KW_: the envelope's steps outside the cylinder, the star's light with the
// magnetosphere's columns (magLight), a lobe of the jet, the planet's light; from their costs on the M1 Max, rounded up);
// the ray's stages (PH_); and its marks, carried from kick to kick (F_)
const float KW_ENV = 0.25, KW_STAR = 8.0, KW_JET = 2.0, KW_PL = 4.0;
const int PH_ENV0 = 1, PH_CUT0 = 2, PH_MARCH = 3, PH_BACK = 4, PH_CUT1 = 5, PH_ENV1 = 6, PH_FINAL = 7, PH_DONE = 8;
const int F_SHEET = 1, F_STAR = 2, F_PG = 4, F_JU = 8, F_JL = 16, F_PL = 32, F_SKIP = 64, F_FINE = 128, F_CFINE = 256, F_CUT = 1024;
// One step of the ray march, from the previous sample (with ln τ* = xPrev) to p over a length ds.
// Returns emission and extinction per unit length for the gas and the wind, and the emission of the
// irradiated skin integrated over the step (it is far thinner than a step, so it is integrated
// analytically through the profile of absorbed starlight).
// The optical/IR march samples local coefficients at the segment centre while
// retaining both endpoints for the analytic integral of the irradiated skin.
// Other callers (wind, cut face, coefficient probes) keep their point samples.
bool gCenteredSegment = false;
// (round 9: the wind's dimming close by depends on the camera alone: set once in main, not at every sample)
float gWindNear = 1.0;
void sampleDisk(vec3 p, vec3 rd, float xPrev, float ds, inout vec3 wq, out vec3 em, out vec3 ex, out vec3 skin, out float x, out float wl){
  em = vec3(0.0); ex = vec3(0.0); skin = vec3(0.0); wl = 0.0;
  float xEnd = 0.0;
  if (gCenteredSegment) { xEnd = lnTauStar(p); p -= 0.5 * ds * rd; }
  float R = max(length(p.xy), 1e-3), lnR = log(R);
  float H = H0 * exp(1.25 * lnR);
  float z = p.z, az = abs(z), zh = z / H;
  float gl = gapLn(R), cut = cutOut(R);
  x = clamp(LNTAU1 - 1.25 * lnR - cut + gl - 0.5 * zh * zh, -30.0, 30.0);
  float xs = gCenteredSegment ? xEnd : x;
  if (R < R_IN * 0.7) { x = xs; wq = vec3(99.0); return; }

  vec2 ed = vec2(1.0, 0.0);   // the eddies here: density factor, extra optical depth toward the star (relative)
#ifdef FULL
  // (in the part cut away only the eddies' shading of the wind's light)
  if (gDiskOff) { if (max(xs, xPrev) > -14.0) ed = eddies(lnR, atan(p.y, p.x), zh); } else
#endif
  if (max(xs, xPrev) > -14.0) {
    float phi = atan(p.y, p.x);
    float Ts = tSurf(R);
    vec4 dm = diskMap(lnR, phi);
    ed = eddies(lnR, phi, zh);
    float E = Eabs(R, lnR, H) * dm.a;
    // the irradiated skin: absorbed starlight j = E |d e^-τ* / dz|, integrated exactly for x varying
    // linearly over the step. The surface is corrugated by the turbulence; slopes facing the star
    // catch more light, and crests cast shadows (both in the disk map). The eddies do the same in three dimensions:
    // a denser eddy absorbs more of the light that reaches it (j ∝ ρ e^-τ*), and shades what lies behind it.
    bool atSkin = max(xs, xPrev) > -4.5 && min(xs, xPrev) < (uMS > 0.0 ? 6.0 : 2.2);
    // (Disk Lab v2) The skin is the light of the small grains at the irradiation surface: scattered starlight and their
    // thermal glow, which the observed looks show. The model's look draws what is there instead, the gas and the small
    // grains as they are distributed, coloured by their temperature (the surface's heating shows as a warmer colour of the
    // gas above it, see Tz below), so that no bright sheet stands at the surface, seen edge-on above all. Bit 2 (uComp.y)
    // is the small grains: in the model's look their glow and their absorption, in the observed looks the skin and the
    // absorption.
    bool skinOn = uLit > 0.0;   // (round 8: the model's look lit by the star, see G_LIT)
#ifdef FULL
    skinOn = skinOn || uLook != 0;
#endif
    if (atSkin && skinOn && (uMode & 2) != 0) {
      float dx = xs - xPrev, xm = 0.5 * (xs + xPrev);
      float P = abs(dx) > 1e-3 ? (exp(-exp(xPrev)) - exp(-exp(xs))) / dx : exp(xm - exp(xm));
      // seen by scattered starlight (near-isotropic grains); the colour stays that of the temperature
      // (round 8: in the model's look the light's fall with the distance is eased to R^-1/2, see G_LIT: the shading shows the
      // surface's tilt toward the star, its shadows and the scattering's direction, not the light's distance)
      float Es = uLook == 0 ? E * LIT_F1 / litFall(R) * inversesqrt(max(R, 0.1)) : E;
      float mu = dot(p, -rd) / max(length(p), 1e-3), base0 = G_SKIN * Es * az / (H * H) * ds * dm.g * ed.x, base = base0 * P * exp(-ed.y);
      float Pd = 0.0;   // multiple scattering: the diffuse light absorbed over the step (see MS_C)
      if (uMS > 0.0) {
        Pd = abs(dx) > 1e-3 ? (exp(-MS_C * exp(xPrev)) - exp(-MS_C * exp(xs))) / dx : MS_C * exp(xm - MS_C * exp(xm));
        Pd *= uMS * MS_A * base0 * exp(-0.5 * ed.y);
      }
      // (the model's look: the star's light on the disk, see G_LIT; the observed looks below)
      skin = (base * hg(mu, G_LIT_HG) + Pd) * (G_LIT * uLit) * litCol();
#ifdef FULL
      if (uLook == 1) skin = (base * hg(mu, G_OPT_HG) + Pd) * G_OPT * SCAT_COL;
      else if (uLook == 2) skin = base * G_MIR * mirPlanck(Ts) * mirColor(Ts);
      else if (uLook == 3) skin = vec3(0.0);
#endif
      skin *= uComp.y;
    }
    // gas with small grains: translucent, glowing with its density in the colour of its temperature (cold
    // midplane; warm only inside the snow line)
    float rho0 = exp(-lnR - cut + gl) * smoothstep(R_IN * 0.8, R_IN * 1.3, R) / (2.5066 * H);   // Sigma / (sqrt(2 pi) H)
    float rho = rho0 * exp(-0.5 * zh * zh) * dm.r * ed.x;   // ... e^(-z²/2H²)
    // (Disk Lab v2) the absorption is the small grains' (bit 2); the glow is shared, half the gas's (bit 1), half the
    // small grains' (bit 2: well mixed with the gas, absent inside R_IN where they sublimate, as rho0 is), in the colour of
    // the temperature here (tempAt, as on the cut's face: round 7; round 6, a cos^4 rise to 2.8 times the midplane's; before,
    // a step at the irradiation surface). The page shows bits 1 and 2 as one, the gas with its dust (round 6: "treat the
    // gas as a mixture with its dust")
    float dustOn = (uMode & 2) != 0 ? uComp.y : 0.0, gasOn = (uMode & 1) != 0 ? uComp.x : 0.0;
    ex = K_G * rho * EXT * dustOn;
    // (beyond OUTER_R the glow is raised as the column thins, by R / OUTER_R, a picture of where the gas is; the temperature
    // is wanted only for this glow, so only where the gas shows and in the model's look: the observed looks set em to 0)
    bool glowT = gasOn + dustOn > 0.0;
#ifdef FULL
    glowT = glowT && uLook == 0;
#endif
    // (round 8: in the colour of its material, MAT_DISK, no longer of its temperature; see MAT in the script)
    if (glowT) em = G_GAS * K_G * rho * MAT_DISK * 0.5 * (gasOn + dustOn) * max(R / OUTER_R, 1.0) * (1.0 - uLit * LIT_DARK * (1.0 - exp(-exp(min(xs, 30.0)))));
    // the surface accretion layer(s) (see ACC): a column ACC_SIG of the local surface density, in its streaks, across a
    // Gaussian in height ACC_W H wide. The layer is thinner than a step, so its column over the step is integrated
    // across that profile (the height changes by rd.z ds over the step) and spread over the step as a mean density.
    // Drawn in the model's look only, with the gas (uMode & 1).
    float aa = accAmp(R) * float(uMode & 1) * uComp.x;
#ifdef FULL
    if (uLook != 0) aa = 0.0;
#endif
    // (round 8: the layers are evaluated only where the step comes within 4 widths of one, ACC_REACH: since the layer runs
    // wherever the disk is not turbulent, out to its edge, evaluating both at every step of the march took about a fifth
    // of the GPU time next to the star; the layers lie below the wind's base, under 4.8 H)
    float dzh = rd.z * ds / H, z0 = zh - dzh, zLo = min(z0, zh), zHi = max(z0, zh);
    if (aa > 0.0 && zLo < 4.8 + ACC_REACH && zHi > -4.8 - ACC_REACH) {
      float za = zAccH(R), fA = asymF(), zl = fA > 0.0 ? zAccLow(R, fA) : za;
      vec2 col = vec2(zHi > za - ACC_REACH && zLo < za + ACC_REACH ? accColumn(z0, zh, za, ds, dzh) : 0.0,
                      zHi > -zl - ACC_REACH && zLo < -zl + ACC_REACH ? accColumn(z0, zh, -zl, ds, dzh) : 0.0) * uAcc;
      if (col.x + col.y > 1e-4) {
        vec2 st = texture(uAccMap, vec2((lnR - LNR_MIN) / LNR_SPAN, phi / TAU + 0.5)).rg;
        float rA = aa * ACC_SIG * rho0 / ACC_W * dot(col, st) / ds;   // (rho0 = Σ / sqrt(2π) H)
        ex += K_G * rA * EXT;
        em += G_ACC * K_G * rA * MAT_ACC;   // (round 8: its material's colour; ACC_COL before)
      }
    }
#ifdef FULL
    if (uLook != 0) { ex *= uLook == 1 ? OPT_K : uLook == 2 ? MIR_K : 0.0; em = vec3(0.0); }
#endif

    // water vapor released inside the snow line, spreading outward (in the model's look)
    for (int i = 0; i < 4; i++) {
#ifdef FULL
      if (uLook != 0) break;
#endif
      vec4 v = uVapor[i]; if (v.w <= 0.0) continue;
      float dt = uTime - v.z, Rv = v.x + 0.03 * dt, Om = OMEGA0 * exp(-1.5 * lnR);
      float dphi = phi - (v.y + Om * dt); dphi = mod(dphi + PI, TAU) - PI;
      float wr = 0.08 + 0.02 * dt, wp = 0.12 + 0.02 * dt;
      float g = exp(-pow((R - Rv) / wr, 2.0) - pow(dphi / wp, 2.0) - 0.5 * zh * zh);
      em += v.w * vec3(0.55, 0.78, 1.0) * g * exp(-dt / 9.0) / H;
    }
  }

  // The magnetically driven wind: gas flowing out along the field lines of the solution (density from the
  // wind map), weaker on the lower side as for a field aligned with the rotation. Its small grains scatter
  // starlight toward the observer (forward, phaseGas), with the softened falloff with distance used for the
  // field lines (which stand for the same grains) and dimmed by the optical depth toward the star, so it
  // rises out of the irradiated surface. It absorbs with the opacity of the disk's small grains, which at
  // these densities is little. wq carries the coordinates of the streaks at the previous sample (99: none); wl returns
  // the wind's brightness here (the march takes finer steps where it is bright, to resolve the streamers).
  vec3 q = vec3(99.0);
  bool windOn = true;
  float wk = 1.0;
#ifdef FULL
  windOn = uLook <= 1;   // the wind and the envelope scatter starlight; no thermal emission is drawn for them
  // (in the part cut away the wind's base goes with the disk, where the disk absorbs the starlight: from tau* = e^-4 to
  // e^-2 the wind fades out toward the disk; above it the wind is whole, its light untouched by the disk's shadows)
  if (gDiskOff) wk = 1.0 - smoothstep(-4.0, -2.0, x);
#endif
  if (x < 2.5 && windOn && (uMode & 8) != 0 && wk > 0.0) {
    vec4 w = windMap(R, z);             // ln r0, azimuth relative to the foot, travel time, ln density
    // the grains that scatter and absorb: none where the gas left the disk inside about 2.5 R_IN (sublimated)
    float r0w = exp(w.x), r = length(p), rho = exp(w.w) * gapFactor(r0w) * (z > 0.0 ? 1.0 : uWindLow) * smoothstep(R_IN, 2.5 * R_IN, r0w);
    float gw = G_WIND, rise = WIND_RISE;
#ifdef FULL
    // (round 8: in their cylinder of before, with the wind's fade of before toward its top and side)
    if (uLook != 0) { gw = G_WIND_OBS * exp(-5.0 * smoothstep(0.55 * ZB_OBS, ZB_OBS, az) - 5.0 * smoothstep(0.55 * RB_OBS, RB_OBS, R)); rise = 0.0; }
#endif
    float lit = gw * gWindNear * K_G * rho / (1.0 + (uLook == 0 ? pow(r / 15.0, ${G(WIND_SOFT)}) : r * r / 225.0))
              * phaseGas(dot(p, -rd) / max(r, 1e-3)) * exp(-gasK() * exp(xRim(R, az, x)) * (1.0 + ed.y))
              * exp(-rise * min(w.w - log(RHO_B) + 1.5 * w.x, 0.0));   // (rho / rho_base)^-WIND_RISE, see G_WIND
    lit *= wk;
    wl = lit;
    if (lit > 2e-4) {
      // the foot of the line, now at azimuth phi - w.y, has turned by w.z since this gas left it
      q = vec3(w.x, atan(p.y, p.x) - w.y - w.z, w.z);
      vec3 d = q - wq; d.y = mod(d.y + PI, TAU) - PI;
      float st = windTurb(q, wq.x > 50.0 ? vec3(0.0) : abs(d), w.w - log(RHO_B) + 1.5 * w.x, length(p - uCam) / max(r, 0.1));
      if ((uMode & 8) != 0) em += lit * st * (uLook == 0 ? MAT_WIND : WIND_COL) * uComp.w;   // (round 8: the model's look in its material's colour)
      ex += K_G * rho * st * EXT * uComp.w * wk;   // (and the wind's with the wind)
    }
  }
  wq = q;
  // the envelope, where it reaches into the marched cylinder (lit unless in the disk's shadow): every envStep along the ray
  if (uEnv > 0.0 && uLook <= 1) {
    gEnvAcc += ds;
    if (gEnvAcc >= envStep(length(p))) { vec3 e1, e2; envLight(p, rd, e1, e2); float k = gEnvAcc / max(ds, 1e-6); em += e1 * k; ex += e2 * k; gEnvAcc = 0.0; }
  }
  x = xs;   // carry the true endpoint into the next continuum segment
}
// One centred continuum interval, including absorption of the skin emission.
void continuumInterval(vec3 p, vec3 rd, float x0, float ds, inout vec3 wq,
                       out vec3 light, out vec3 trans, out float x, out float wl){
  vec3 em, ex, sk;
  gCenteredSegment = true;
  sampleDisk(p, rd, x0, ds, wq, em, ex, sk, x, wl);
  gCenteredSegment = false;
  vec3 tau = ex * ds;
  trans = exp(-tau);
  light = (em * ds + sk) * transferWeight(tau);
}
float maxChannel(vec3 v){ return max(v.x, max(v.y, v.z)); }
// The envelope outside the cylinder, marched in ENV_N steps from t0 to t1 (it is smooth): beyond the disk the
// starlight is blocked within the angle of the disk's surface seen from the star (z/R below about 0.16)
// (round 10a: from its step i, until the kick's budget is spent, see SPLIT: true when it has ended; whole where the ray is
// drawn in one go, the budget unbounded. Its part cut away (skip), never given, is gone)
bool envMarch(vec3 ro, vec3 rd, float t0, float t1, float jitter, inout int i, inout vec3 col, inout vec3 tr, inout float budget){
  if (t1 <= t0) return true;
  int n = uEnv < 0.5 ? ENV_N / 2 : ENV_N;   // (round 8: half as many while it is faint, from 40 to 110 au away)
#ifdef FULL
  if (uLook == 1) n = 640;
#endif
  float ds = (t1 - t0) / float(n);
  for (int k = 0; k < 640; k++) {
    if (i >= n || max(tr.r, max(tr.g, tr.b)) < 0.004) return true;   // (round 8: not behind what hides it)
    if (budget <= 0.0) return false;
    budget -= KW_ENV;
    float t = t0 + (float(i) + jitter) * ds;
    i++;
    vec3 em, ex; envLight(ro + rd * t, rd, em, ex);
    vec3 a = exp(-ex * ds);
    col += tr * em * ds * transferWeight(ex * ds);
    tr *= a;
  }
  return true;
}
#ifdef FULL
// The cut takes away the disk (with its sheet of pebbles, the planet, the magnetosphere's columns and the wind's base on
// the disk), not the gas around it: the wind and the envelope in the part cut away, marched from t0 to t1 (within the
// cylinder) with the disk left out, in at most 32 steps of the wind's size (round 13: so that the sky past the plane
// seen edge-on is the same on both sides; before, the part cut away was empty, and the sky behind it showed without the
// wind in front). Not in the observed looks (no wind there).
// (round 8, the owner: "the cut's background is too lazy") The wind kept in the part cut away lay over the faces and the
// rest of the picture as a flat blue-grey haze (marched in at most 32 long steps, its streamers faded below the steps'
// size): it is drawn at CUT_VEIL of its light, so that the faces and the volume behind them read at their full quality.
const float CUT_VEIL = 0.3;
// (round 10a) In kicks (see SPLIT): its state (t, the place of its last sample ts, xPrev, wq, wl, its step j) made at t0 by
// cutStart (where it marches at all: cutWants), and marched to t1 by cutWind until the kick's budget is spent (false: on in
// the next kick) or to its end (true). Each step's size is taken at the last sample's place, as before (p, from ts)
bool cutWants(float t0, float t1){ return t1 > t0 && uLook <= 1; }
void cutStart(vec3 ro, vec3 rd, float t0, out float t, out float ts, out float xPrev, out vec3 wq, out float wl, out int j){
  t = t0; ts = t0; wl = 0.0; wq = vec3(99.0); j = 0;
  xPrev = lnTauStar(ro + rd * t0);
}
bool cutWind(vec3 ro, vec3 rd, float t1, float jitter, inout float t, inout float ts, inout float xPrev, inout vec3 wq, inout float wl, inout int j, inout vec3 col, inout vec3 tr, inout float budget){
  gDiskOff = true;
  bool done = false;
  for (int k = 0; k < 32; k++) {
    if (j >= 32 || t >= t1 || max(tr.r, max(tr.g, tr.b)) < 0.01) { done = true; break; }
    if (budget <= 0.0) break;
    budget -= 1.0;
    vec3 p = ro + rd * ts;
    float Hs = H0 * pow(max(length(p.xy), 0.2), 1.25), az = abs(p.z), rr = length(p);
    bool fine = wl > WIND_FINE;
    // (the wind's steps; inside the disk's height, where the wind is not, those it has at 4 scale heights; and long
    // enough to reach t1 in the steps left)
    float ds = clamp(max(0.4 * Hs, (fine ? WIND_DS : 0.25) * max(az, 4.0 * Hs)), 0.004, fine ? max(WIND_DSMAX, windDs(rr)) : max(0.4, 0.05 * rr));
    ds = max(ds, (t1 - t) / float(32 - j));
    float t2 = min(t + ds, t1);
    ds = t2 - t;
    // (Disk Lab v2, round 6: the sample at the jitter's place within every step. The jitter used to shorten the first
    // step only, and the steps after it share out what is left of the stretch evenly, so its shift died away toward the
    // stretch's end: next to the cut, where these rays cross the wind's bright base under the disk, the samples stood
    // at the same places in every frame, and the base showed as fine concentric ripples that no still picture smoothed)
    ts = t + jitter * ds;
    p = ro + rd * ts;
    vec3 em, ex, sk; float x;
    sampleDisk(p, rd, xPrev, ds, wq, em, ex, sk, x, wl);
    vec3 a = exp(-ex * ds);
    col += tr * em * ds * transferWeight(ex * ds) * CUT_VEIL;
    tr *= a;
    xPrev = x; t = t2; j++;
  }
  gDiskOff = false;
  // (and done where its 32 steps are all taken in this call: the loop ends then without seeing it. Missed, a ray drawn whole
  // never left the cut's stage, and its pixel was never written: black specks around the star at the heat place, the
  // round's full check)
  return done || j >= 32 || t >= t1 || max(tr.r, max(tr.g, tr.b)) < 0.01;
}
#endif
vec2 boundsSphere(vec3 ro, vec3 rd, float R){
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, d = b * b - c;
  if (d < 0.0) return vec2(1.0, 0.0);
  float s = sqrt(d);
  return vec2(max(-b - s, 0.0), -b + s);
}

// The settled dust is far thinner than a ray step, so it is integrated analytically where the ray
// crosses the midplane: a sheet of surface density Σ_d(R, φ), icy beyond the snow line. It hides
// what lies behind it, and glows in proportion to its (millimetre-like, mostly thin) optical depth,
// so pile-ups and clumps of pebbles stand out.
void sheet(vec3 p, vec3 rd, inout vec3 col, inout vec3 tr){
  if (uComp.z <= 0.0) return;   // (pebbles off: absent, nor do they absorb)
  float mu = abs(rd.z);
  float R = length(p.xy);
  if (R < R_IN || R > RB) return;
  float lnR = log(R), phi = atan(p.y, p.x);
  float Om = OMEGA0 * exp(-1.5 * lnR), H = H0 * exp(1.25 * lnR);
  float Tm = tMid(R, lnR);   // (round 7: the midplane's temperature, see tempAt)
  float ice = 1.0 - smoothstep(TICE - 6.0, TICE + 6.0, Tm);
  float pile = 1.0 + 1.2 * ice * exp(-pow((R - 1.15 * uRSnow) / (0.13 * uRSnow), 2.0));
  // with the planet, pebbles are filtered out of the gap (deeper and a little wider than in the gas) and collect
  // at the pressure maximum just outside it, a bright ring, once the gap is deep enough to make one (uTrap)
  // (none inside the planet's Hill sphere, where its own disk is)
  // (each planet's, multiplied)
  float trap = 1.0;
  for (int i = 0; i < MAXP; i++) {
    if (i >= uNP) break;
    if (uPl[i].y <= 0.0) continue;
    // (round 6: filtered out of the gas's gap a tenth wider, the ring half a scale height wide, uPlTrap.w)
    float sg = gapShape(i, uPl[i].x + (R - uPl[i].x) / 1.1), xt = (R - uPlTrap[i].x) / uPlTrap[i].w;
    trap *= (1.0 - uPlTrap[i].y * sg) * (1.0 + PEB_RING * uPlTrap[i].z * exp(-xt * xt));
  }
  trap /= gapFactor(R);
#ifdef FULL
  if (uPlV.w > 0.0) trap *= smoothstep(1.5 * rCPD(uPlVa), 2.5 * rCPD(uPlVa), length(p - uPlV.xyz));
#endif
  vec4 dm = diskMap(lnR, phi);
  // (round 8: the pebbles' own outer edge, R_PEB, inside the gas's: see MODEL.R_PEB in the script)
  float sd = ${G(MODEL.SD0)} * Sigma(R, lnR) * exp(cutOut(R) - pow(R / ${G(MODEL.R_PEB)}, P_OUT)) * trap * pile * (0.5 + 0.5 * ice) * dm.b, sc = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 c = uClump[i]; if (c.w <= 0.0) continue;
    float dt = uTime - c.z; float Rc = c.x - 0.05 * dt; if (Rc < R_IN || dt < 0.0) continue;   // (none before its drop)
    float dphi = phi - (c.y + Om * dt); dphi = mod(dphi + PI, TAU) - PI;
    float w = 0.10 + 0.012 * dt;
    // (three times as much at first, settling within seconds, so that a clump just dropped is seen where it fell)
    sc += c.w * 0.05 * (0.45 + 0.55 * ice) * exp(-pow((R - Rc) / 0.08, 2.0) - pow(dphi / w, 2.0)) * exp(-dt / 70.0) * (1.0 + 2.0 * exp(-dt / 4.0));
  }
  sd += sc;
  sd *= uComp.z; sc *= uComp.z;   // (the pebbles as they fade, their absorption with their light; the millimetre follows them)
#ifdef FULL
  if (uLook != 0) {
    // millimetre: the pebbles' thermal emission (Rayleigh-Jeans, nearly thin); in scattered light and the
    // mid-infrared they lie inside the opaque disk
    if (uLook == 3) { float tm = K_MM * sd / max(mu, 0.15); col += tr * G_MM * (Tm / 100.0) * absorptionFraction(tm) * MM_COL; tr *= exp(-tm); }
    else if (uLook == 4) tr *= exp(-K_MM * sd / max(mu, 0.15));
    else tr *= exp(-K_D * sd / max(mu, 0.03));
    return;
  }
#endif
  float tau = K_D * sd / max(mu, 0.03);
  float tmm = K_MM * sd / max(mu, 0.3);
  vec3 alb = mix(MAT_ROCK * 0.25, 0.9 * MAT_ICE, ice);   // (round 8: rock and ice, materials; the ice was in the colour of its temperature)
  alb = mix(alb, vec3(0.85, 0.92, 1.0) * mix(0.35, 1.0, ice), sc / (sd + 1e-6));   // packed pebbles look paler
  vec3 src = G_DUST * alb * Eabs(R, lnR, H) * dm.a * absorptionFraction(tmm) * (1.0 + PILE * (pile - 1.0));
  col += tr * src;
  tr *= exp(-tau);
}

// (round 8) The jet (see JET in the script): its emission per unit length at p (relative; its density, as 1 / r^2, times the
// knots) and, for a ray, its light from each lobe (the stretch of the ray on that side within 3.5 widths of the axis, in 16
// samples), laid in where the ray passes the axis on that side, so that the disk in front of a lobe dims it.
uniform float uJet;      // its strength in this look, as it fades in (0: none)
uniform float uJetLow;   // the lower lobe's speed relative to the upper's (1, or 1 / JET.LOW with the asymmetry)
uniform float uJetT;     // the model's clock (modulo 3600 s, a multiple of both periods)
const float JET_V = ${G(+JET.V.toFixed(5))}, JET_RL = ${G(JET.RL)}, JET_RC = ${G(JET.RC)}, JET_TAN = ${G(+Math.tan(JET.CONE).toFixed(6))}, JET_BASE = ${G(JET.BASE)};
const float JET_Z0 = ${G(JET.Z0)}, JET_ZMAX = ${G(JET.ZMAX)}, JET_P1 = ${G(JET.P1)}, JET_P2 = ${G(JET.P2)}, JET_K1 = ${G(JET.K1)}, JET_K2 = ${G(JET.K2)};
// (JET_SOFT: below about this half width, its light per volume grows no more, a display choice: within a few au of the star,
// where it is still being collimated, it fades toward its foot rather than outshine the inner disk in the close views.
// Round 9: 1 au before, for the wider jet)
const float JET_SOFT = 0.3;
// (its light per unit of jetEm, chosen by eye: clear from afar, not outshining the wind close up. Round 9: 0.12 before; the
// narrower jet's light per volume is higher, 4 to 5 times at 1 to 10 au, so a fifth of it leaves it as bright as before at
// its axis or a little less, and discreet as the owner asked)
const float G_JET = 0.025;
// (round 9, see JET: a cone from its foot, then one of CONE; until round 8 the widening as the square root of the height)
float jetR(float az){ return min(JET_RL + JET_BASE * az, JET_RC + JET_TAN * az); }
float jetEm(vec3 p){
  float az = abs(p.z);
  if (az < JET_Z0 || az > JET_ZMAX) return 0.0;
  float r = jetR(az), sg = 0.85 * r, d2 = dot(p.xy, p.xy);
  if (d2 > 16.0 * sg * sg) return 0.0;
  float low = p.z < 0.0 ? uJetLow : 1.0, v = JET_V * low, tl = uJetT - az / v;   // (the time this gas was launched)
  float u1 = fract(tl / JET_P1) - 0.5, u2 = fract(tl / JET_P2) - 0.5;
  float k = 1.0 + JET_K1 * smoothstep(20.0, 80.0, az) * exp(-u1 * u1 / 0.0064) + JET_K2 * smoothstep(3.0, 25.0, az) * exp(-u2 * u2 / 0.0144);
  return k / (low * (r * r + JET_SOFT * JET_SOFT)) * exp(-0.5 * d2 / (sg * sg)) * smoothstep(JET_Z0, 3.0 * JET_Z0, az) * (1.0 - smoothstep(0.85 * JET_ZMAX, JET_ZMAX, az));
}
// a lobe (side +1 or -1): its light (relative, x; times jetCol) and where it is laid in (y; 1e9: none). (Two numbers a
// lobe, carried through the march: the four of a colour and a place each slowed the whole march, as the registers grew)
// (round 10a: light false, the place alone, its light 0: the light's 16 samples are taken when it is laid in, see main)
vec2 jetLobe(vec3 ro, vec3 rd, float side, float jitter, bool light){
  if (abs(rd.z) < 1e-6) return vec2(0.0, 1e9);
  float ta = (side * JET_Z0 - ro.z) / rd.z, tb = (side * JET_ZMAX - ro.z) / rd.z, t0 = max(min(ta, tb), 0.0), t1 = max(ta, tb);
  if (t1 <= t0) return vec2(0.0, 1e9);
  float a = dot(rd.xy, rd.xy), tc = a > 1e-8 ? clamp(-dot(ro.xy, rd.xy) / a, t0, t1) : t0;
  vec3 pc = ro + rd * tc;
  float rc = jetR(abs(pc.z)), dc = length(pc.xy);
  if (dc > 3.5 * 0.85 * rc) return vec2(0.0, 1e9);
  float L = min(3.5 * 0.85 * rc / max(sqrt(a), 1e-4), 0.5 * (t1 - t0)), c = clamp(tc, t0 + L, t1 - L), ds = 2.0 * L / 16.0;
  float e = 0.0;
  // (round 8: faded close to the camera, within half its distance from the point looked at: looking down the axis the camera
  // sits in the jet's wide part, which then veiled the whole view)
  if (light) for (int i = 0; i < 16; i++) { float ti = c - L + (float(i) + jitter) * ds; e += jetEm(ro + rd * ti) * smoothstep(0.15, 0.5, ti / uFocus); }
  return vec2(G_JET * uJet * e * ds, c);
}
// (its colour: the visible look the red of its lines)
vec3 jetCol(){ return uLook == 0 ? MAT_JET : vec3(1.0, 0.22, 0.28); }

uniform int uRayB;        // (round 10a) the bound on a long ray's work (CO_IT, CT_IT): 1, or 0 as before, to compare
uniform int uCtMax;       // (round 10a, a switch to try on a phone: the continuum's iterations at most; 32768, none)
// (round 9) the march's tier (MARCH in the script): x the continuum's substeps a step, y the CO line's step in geometric steps,
// z its halvings at most; uCoIt and uCtIt the long-ray bounds of the CO line and the continuum (see CO_IT, CT_IT)
uniform vec4 uMarch;
uniform vec3 uCoIt, uCtIt;
uniform int uCoRec;       // (round 9) the gas line's march rec (see CO_MARCH_GLSL), or 0 the one before it, to compare
// (round 9) the moments' passes (see coGrid): uCoPass 2 a pass of sums from group uCoG0 (uCoP groups: 1 or 3), 3 the
// composite, 0 none; uCoAcc the window and the sums so far; uCoDith the grid's offset
uniform int uCoPass, uCoG0, uCoP;
uniform float uCoDith;
uniform highp sampler2D uCoAcc;
const float LIGHT_MAX = 1e4, CONT_EPS = 3e-5;   // (round 9: the continuum's end, see main)
uniform int uProbe;       // (round 9) 1: the volume pass writes the march's iterations instead of light (diskRayProbe); 2: the gas line's values
uniform int uBg;          // (round 8) the background: 0 none, 1 the stars, 2 the sky of a star-forming region (see BG)
uniform sampler2D uSky;   // its map (see SKY_FS), with uBg = 2
// stars fixed on the sky, at a density per CSS pixel so small panels are not crowded: in cells of cell CSS px, a star in
// the share dens of them, its brightness from bmin to bmin + bmax (most faint), the brightest with a soft glow; ext dims
// and reddens it (the cloud's transmission), except for a few in front of the cloud. (Round 9: a star is at least 0.6
// render pixels wide, its light kept, so that it neither vanishes between the pixels' centres nor flickers as the view
// turns at a low render scale; before, 0.55 CSS px at any scale.)
vec3 starsIn(vec3 rd, float pixA, float cell, float dens, float bmax, float bmin, float glow, float seed, vec3 ext){
  float cs = cell * uPx * pixA;
  vec3 c = floor(rd / cs);
  float h = hash13(c + 0.37 * uSeed + seed);
  if (h < 1.0 - dens) return vec3(0.0);
  vec3 o = vec3(hash13(c + 1.3 + seed), hash13(c + 2.9 + seed), hash13(c + 4.1 + seed));
  vec3 sdir = normalize((c + 0.2 + 0.6 * o) * cs);
  float sig0 = 0.55 * uPx * pixA, sig = max(sig0, 0.6 * pixA), u = (h - 1.0 + dens) / dens;
  float d2 = dot(rd - sdir, rd - sdir) / (sig * sig);
  float b = u * u * u * bmax + bmin, prof = (sig0 * sig0) / (sig * sig) * exp(-0.5 * d2) + glow * u * u * u * exp(-sqrt(d2) * sig / (2.5 * uPx * pixA));
  if (hash13(c + 9.7 + seed) < 0.06) ext = vec3(1.0);   // (in front of the cloud)
  return mix(vec3(0.76, 0.84, 1.0), vec3(1.0, 0.87, 0.72), o.x) * b * prof * ext;
}
// (round 9, the owner: "the stars a little brighter") more of them and brighter (2.2 % of 10 px cells; 1.5 % of 11 before,
// the brightest 0.135 against 0.064), the brightest with a soft glow
vec3 stars(vec3 rd, float pixA){ return starsIn(rd, pixA, 10.0, 0.022, 0.13, 0.005, 0.22, 0.0, vec3(1.0)); }

// The planet and its circumplanetary disk, drawn when the camera comes within a few au of the planet (uPlanetVis). The
// disk is two flattened Gaussian clouds, its hot inner part and the disk out to 0.4 Hill radii, whose columns along the
// ray are integrated analytically; the planet is a point of light in the middle, partly veiled by them. They are
// composited where the ray passes closest to the planet.
// column along the ray through exp(-(x² + y²)/2s² - z²/2zeta²) centred at the planet (q = ro - planet), in units of
// its vertical column through the centre
float cloud(vec3 q, vec3 rd, float s, float zeta){
  vec3 k = vec3(1.0, 1.0, s / zeta), qs = q * k, ds = rd * k;
  float dd = dot(ds, ds), qd = dot(qs, ds), b2 = max(dot(qs, qs) - qd * qd / dd, 0.0);
  return s / (zeta * sqrt(dd)) * exp(-0.5 * b2 / (s * s));
}
// three nested clouds (widths in units of the disk's radius, 0.4 Hill radii; thickness CPD_HR of the width, a disk of
// aspect ratio H/R = 0.1), with their vertical optical depths and their glow, hotter inside (heated by accretion onto the
// planet). (Disk Lab v2, round 6: CPD_HR 0.1 for all three, the owner's "H/R about 0.1"; before 0.133, 0.15 and 0.164, a
// lens whose isophotes had an aspect of 0.135 to 0.158. Simulations give 0.1 to 0.3, e.g. Ayliffe & Bate 2009 about 0.2)
// (Round 7, the owner: "is the CPD's radius about 0.3 R_Hill now?". Not to the eye: measured at the planet's place, its
// light fell to a half at 0.07 R_H and to a quarter at 0.21 R_H, a bright core whose faint rest reached 0.4-0.5 R_H only at
// 10-5 per cent: the clouds were thin (a vertical optical depth of 1.6 through the centre) and the inner one carried most
// of the light. Now they stand for a disk whose surface density falls as r^-3/4 (steady accretion) out to its tidal
// truncation at 0.4 R_H (Martin & Lubow 2011; R_H/3 in Ayliffe & Bate 2009): widths 0.1, 0.3 and 0.55 of R_CPD, optical
// depths CPD_TAU in the ratio that fits that profile (non-negative least squares on 0-1.6 R_CPD), opaque in the middle
// (6 through the centre) so that the light is that of its surface out to where the disk thins, in the colours of a disk
// heated by accretion, T ∝ r^-3/4 from 1200 K at 0.1 R_CPD. See DESIGN.md, section 17, for the profile measured again.)
// (Round 8, the owner: "I can't see the CPD's flaring; is something wrong?". Two things were: one aspect ratio for all three
// clouds makes nested similar ellipsoids, a lens whose isophotes close at the edge whatever the ratio; and 0.1 is thin
// against the simulations, 0.2-0.6 (Ayliffe & Bate 2009; Martin & Lubow 2011 for H/r >~ 0.2 in its accreting phase, 0.1
// late). Now each cloud has the CPD's own H/r at its half-light radius (1.5 times its width), uCpd.xyz from the script:
// the larger of an accretion-heated floor of 0.1 (nearly flat, H/r ∝ r^1/8: Martin & Lubow 2011, eq. 4) and the hydrostatic
// disk at the parent disk's temperature, 0.83 q_th^-1/3 x^1/2 (1 + x^3/3)^-1/2 with x = r / R_H and q_th = q / h_p^3 the
// planet's mass in thermal masses (the form of Tanigawa et al. 2012, eq. 14, and Fung et al. 2019, eqs. 22-23: H ∝ r^3/2
// near the planet, so H/r grows outward): for a Jupiter at 3 au 0.12, 0.21 and 0.29, a flared disk; capped at 0.8, so that
// a planet of under a few thermal masses (q_th <~ 1-3, 10 Earth masses everywhere here) wears a nearly round envelope
// rather than a disk, as the simulations find (Ayliffe & Bate 2009; Sagynbayeva et al. 2024). uCpd.w: its glow for the
// planet's mass (see glowOf).)
uniform vec4 uCpd;
const vec3 CPD_TAU = vec3(2.84, 1.93, 1.23), CPD_G = vec3(1.4, 0.9, 0.6);
vec4 planetLight(vec3 ro, vec3 rd, float aspect){
  vec3 q = ro - uPlV.xyz;
  float R_CPD = rCPD(uPlVa);
  float t1 = CPD_TAU.x * cloud(q, rd, 0.1 * R_CPD, uCpd.x * 0.1 * R_CPD), t2 = CPD_TAU.y * cloud(q, rd, 0.3 * R_CPD, uCpd.y * 0.3 * R_CPD), t3 = CPD_TAU.z * cloud(q, rd, 0.55 * R_CPD, uCpd.z * 0.55 * R_CPD);
  float tt = t1 + t2 + t3;
  // (round 8: in the model's look the planet's material colour, lighter toward the middle; in the observed looks the
  // colours of the temperatures of a disk heated by accretion)
  bool mat = uLook == 0;
  vec3 c1 = mat ? mix(MAT_PLANET, vec3(1.0), 0.35) : tcolor(1200.0), c2 = mat ? MAT_PLANET : tcolor(530.0), c3 = mat ? 0.8 * MAT_PLANET : tcolor(330.0);
  vec3 em = (t1 * CPD_G.x * c1 + t2 * CPD_G.y * c2 + t3 * CPD_G.z * c3) * transferWeight(tt);
  // the planet, a point (its radius, 1.5 Jupiter radii, is below a pixel unless the camera is within about 0.3 au)
  vec3 pv = vec3(dot(-q, uBasis[0]), dot(-q, uBasis[1]), dot(-q, uBasis[2]));
  if (pv.z > 0.0) {
    vec2 ppx = (vec2(pv.x / (pv.z * uTanHalf * aspect), pv.y / (pv.z * uTanHalf)) * 0.5 + 0.5) * uRes;
    float d = length(gFc - ppx) / uPx, rp = 0.0007 / (pv.z * 2.0 * uTanHalf / uRes.y) / uPx;   // CSS px
    em += (mat ? mix(MAT_PLANET, vec3(1.0), 0.5) : tcolor(1300.0)) * (4.0 * exp(-max(d - rp, 0.0) * max(d - rp, 0.0) / 0.8) + 0.1 * exp(-d / 2.5)) * exp(-0.25 * tt);
  }
  return vec4(em * uCpd.w, tt) * uPlV.w;
}

// Quantities on the cut face at the point Rs (signed, along uSliceR) and z of the plane, with phi its azimuth:
// the temperature (tempAt; round 7), log10 of the gas density (the disk with its turbulence, plus the wind) relative to the midplane
// at 1 au, and ln tau* toward the star (the smooth disk, as for the irradiation). The same expressions as
// the volume uses.
const float LN10 = 2.302585;
const float ENV_R = ${G(ENV.R)};
vec3 sliceQuantities(float Rs, float z, float phi){
  float R = max(abs(Rs), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR), zh = z / H;
  float x = clamp(xRim(R, abs(z), LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R) - 0.5 * zh * zh), -30.0, 30.0);
  vec4 w = windMap(R, z);
  // (close to the star, uMag, the gas disk reaches the magnetosphere's edge, inside the dust's: see MAG)
  float gasIn = uMag * max(smoothstep(MAG_RT * 0.95, MAG_RT * 1.08, R) - smoothstep(R_IN * 0.8, R_IN * 1.3, R), 0.0);
  // (Disk Lab v2, round 6: the wind map carries the volume's fade toward the top and the side of the marched cylinder,
  // a choice for the picture (see WINDMAP_FS); the face shows the solution, so the soft part of that fade, which took
  // the wind's density down by up to 2.4 dex in the outer quarter of the cylinder, is taken back out here. The last 15 %
  // of the fade remains, at the cylinder's edge, where the face ends.)
  float wEdge = 5.0 * smoothstep(0.55 * ZB, ZB, abs(z)) + 5.0 * smoothstep(0.55 * RB, RB, R);
  float rho = (Sigma(R, lnR) + gasIn * exp(-lnR - cutOut(R) + gapLn(R))) / (2.5066 * H) * exp(-0.5 * zh * zh) * diskMap(lnR, phi).r * eddies(lnR, phi, zh).x
            + exp(w.w + wEdge + gapLn(exp(w.x))) * (z > 0.0 ? 1.0 : uWindLow);
  return vec3(uSliceQ == 1 ? tempAt(R, lnR, zh, x) : 0.0, log(max(rho, 1e-30) * ${G(Math.sqrt(2 * Math.PI) * MODEL.H0)}) / LN10, x);
}
// The stretch (tIn, tOut) of the ray in the part cut away (empty when tIn >= tOut): the intersection of the two
// half-spaces dot(p, n_i) > uSliceOff, so a single stretch, as the part is convex. (A camera within 1e-5 of its distance
// from a plane is put on it: the 1/4 cut's second plane passes through the camera, seen edge-on, and the float's
// rounding put the camera on either side of it, so that every ray on one side of the picture met that plane at the
// camera itself, or none on the other side entered the part cut away from the start; on the plane, the rays on one side
// start in the part cut away and the others in the part kept.)
// (round 8) the plane the ray leaves the part cut away through, from the last cutSpan: 0 the turned one (the 1/4 cut's
// left face), 1 the one facing the camera (its right face; the 1/2 cut's only face)
int gCutExit = 1;
vec2 cutSpan(vec3 ro, vec3 rd){
  float ca = cos(2.0 * uCutA), sa = sin(2.0 * uCutA), lo = -1e9, hi = 1e9, tol = 1e-5 * max(length(ro), 1.0);
  gCutExit = 1;
  for (int i = 0; i < 2; i++) {
    vec3 n = i == 0 ? ca * uSliceN + sa * uSliceR : uSliceN;
    float s0 = dot(ro, n) - uSliceOff, sv = dot(rd, n);
    if (abs(s0) < tol) s0 = 0.0;
    if (abs(sv) < 1e-7) { if (s0 <= 0.0) return vec2(1e9, -1e9); }
    else if (sv > 0.0) lo = max(lo, -s0 / sv);
    else if (-s0 / sv < hi) { hi = -s0 / sv; gCutExit = i; }
  }
  return vec2(lo, hi);
}
// (round 8, the owner: "with the 1/4 cut, just don't put a face on the left plane") the face is painted on the right plane
// only, once the cut has turned past halfway to the quarter; through the left plane the volume left there is seen as it is
bool facePainted(){ return gCutExit == 1 || uCutA < 0.39; }
// colour maps for the cut face, in display values (matplotlib's viridis and inferno, sampled at 11 points)
const vec3 VIRIDIS[11] = vec3[11](vec3(0.267, 0.005, 0.329), vec3(0.283, 0.141, 0.458), vec3(0.254, 0.265, 0.530), vec3(0.207, 0.372, 0.553),
  vec3(0.164, 0.471, 0.558), vec3(0.128, 0.567, 0.551), vec3(0.135, 0.659, 0.518), vec3(0.267, 0.749, 0.441), vec3(0.478, 0.821, 0.318),
  vec3(0.741, 0.873, 0.150), vec3(0.993, 0.906, 0.144));
const vec3 INFERNO[11] = vec3[11](vec3(0.001, 0.000, 0.014), vec3(0.087, 0.045, 0.225), vec3(0.258, 0.039, 0.406), vec3(0.416, 0.090, 0.433),
  vec3(0.578, 0.148, 0.404), vec3(0.736, 0.216, 0.330), vec3(0.865, 0.317, 0.226), vec3(0.955, 0.469, 0.100), vec3(0.988, 0.645, 0.040),
  vec3(0.964, 0.844, 0.273), vec3(0.988, 0.998, 0.645));
vec3 cmap(float t, bool inferno){
  t = clamp(t, 0.0, 1.0) * 10.0; int i = min(int(t), 9);
  return inferno ? mix(INFERNO[i], INFERNO[i + 1], t - float(i)) : mix(VIRIDIS[i], VIRIDIS[i + 1], t - float(i));
}
// The regions of the coupling (quantity 4, 'layers'; see NONIDEAL and ACC), in flat colours: below the wind's base (the
// irradiation surface, tau* = 1) the strongly turbulent, thermally ionized inner disk, the dead zone (below z_k), the
// laminar gas above it (and beyond it, the whole column) and the accretion layer(s) in it (within 1.2 ACC_W of their
// centres, on the side(s) that accrete), the weakly turbulent outer disk; above the base the wind, translucent. The disk's
// edge ends the face as the temperature's does. (Disk Lab v2, round 6: each point in one region, the legend's (the owner
// asked for categories that neither overlap nor leave gaps): the wind is one translucent colour wherever the model has
// wind (it faded with its density, so that a thin part was neither wind nor anything else), and clear only where the
// model has no gas, the tube along the axis that no field line of the model fills, as the hole inside the inner edge is)
// (round 8: no "laminar" region: the dead zone, the accretion layer and the wind are all laminar. Between the accretion
// layer and the wind's base lies the wind-launching region, LAY_BASE (the field opens and the gas is lifted slowly); with the
// asymmetry the lower side's layer rises, and under it the field is wound one way by the Hall effect, LAY_HALL; see ACC)
const vec3 LAY_MRI = vec3(0.88, 0.47, 0.27), LAY_DEAD = vec3(0.15, 0.19, 0.34), LAY_BASE = vec3(0.36, 0.62, 0.70), LAY_ACC = vec3(1.0, 0.71, 0.28), LAY_WIND = vec3(0.64, 0.85, 0.95);
const vec3 LAY_HALL = vec3(0.54, 0.60, 0.36);
const vec3 LAY_JET = vec3(1.0, 0.42, 0.36);   // (round 8: the jet, within its half width at half maximum)
const vec3 LAY_WEAK = vec3(0.73, 0.56, 0.60);   // (Disk Lab v2: the weakly turbulent outer disk, outerAmp)
// Close to the star (uMag), the magnetosphere's regions (see MAG) at p3 (alpha 0 elsewhere): the region of the
// closed lines inside the disk's inner edge (no disk there: the cavity), the curtains' cross-section (the lines L =
// MAG_RT to MAG_RT (1 + MAG_DL) where the gas falls, where a curtain is denser than 0.3 of its middle, as in magColumn)
// and (gas) the dust-free gas disk between the magnetosphere's edge and the dust's (within 2 H of the midplane); inside
// the dust's edge nothing else (the face is open there, as from afar). On every quantity's face, so that the curtains
// are not taken for the disk's own flows: labelled in the overlay.
const vec3 LAY_MAG = vec3(0.60, 0.48, 0.86), LAY_STREAM = vec3(1.0, 0.36, 0.50);
vec4 magFace(float R, float z, vec3 p3, bool gas){
  float r = length(p3), cz = dot(p3, uMagAxis) / max(r, 1e-6), L = r / max(1.0 - cz * cz, 1e-5), u = (L / MAG_RT - 1.0) / MAG_DL;
  if (u < 0.0) return vec4(LAY_MAG, 0.6);
  float phm = atan(dot(p3, cross(uMagAxis, uMagE1)), dot(p3, uMagE1)), dph = cz > 0.0 ? phm : PI - abs(phm);
  if (u < 1.0 && magAz(dph) * smoothstep(0.08, 0.3, abs(cz)) > 0.3) return vec4(LAY_STREAM, 0.9);
  // (the dust-free gas disk on the regions' face: thermally ionized and turbulent, the inner disk's region, not one of its
  // own; round 6, as the legend's categories are by the coupling, not by the dust)
  if (gas && R > MAG_RT && R < R_IN * 1.05 && abs(z) < 2.0 * H0 * pow(R, 1.25)) return vec4(LAY_MRI, 1.0);
  return vec4(0.0);
}
vec4 layersFace(float R, float z, vec3 q){
  float H = H0 * pow(R, 1.25), zh = abs(z) / H, zb = zBase(R) / H, zk = zKinkH(R), f = asymF();
  bool low = z < 0.0;
  float za = low ? zAccLow(R, f) : zAccH(R);
  if (uJet > 0.0 && abs(z) > JET_Z0 && R < jetR(abs(z))) return vec4(LAY_JET, 0.8);   // (round 8: the jet along the axis)
  if (zh > zb || q.z < -4.0) return vec4(LAY_WIND, 0.5 * smoothstep(-11.5, -10.5, q.y));
  // (round 8, from the midplane up: the dead zone, the accretion layer where the field bends, the wind-launching region, the
  // wind; the turbulent inner disk and the weakly turbulent outer disk, with the layer at the midplane there)
  vec3 c = LAY_BASE;
  if (mriAmp(R) > 0.5) c = LAY_MRI;
  else if (abs(zh - za) < 1.2 * ACC_W && (low ? uAcc.y : uAcc.x) * accAmp(R) > 0.5) c = LAY_ACC;
  else if (zh < zk) c = LAY_DEAD;
  else if (low && f > 0.5 && zh < za) c = LAY_HALL;
  else if (outerAmp(R) > 0.5) c = LAY_WEAK;
  return vec4(c, 1.0);
}
// The cut face at pc: the colour (display values) and its opacity. The temperature is shown in the colours
// the volume uses for it, over the disk and its irradiated surface layer (up to tau* of about 0.01); the
// density (log10, from 10^-10 to 10^2.5 of the midplane at 1 au) over the disk and the wind; the optical
// depth (log10 tau* from -4 to 5) over the disk. The dust-free hole inside R_IN stays open.
vec4 sliceFace(vec3 pc){
  // (the star is not painted on the face: its sphere is the volume's, whole also with the cut, so that it shows in one
  // colour on both sides of the face's edge)
  if (dot(pc, pc) < MAG_RS * MAG_RS) return vec4(0.0);
  float R = length(pc.xy), z = pc.z / uSliceZ;   // the plane may be off the star while it sweeps
  vec3 q = sliceQuantities(R, z, atan(pc.y, pc.x));
  float hole = smoothstep(R_IN * 0.8, R_IN * 1.3, R), holeG = max(hole, uMag * smoothstep(MAG_RT * 0.95, MAG_RT * 1.08, R));   // (the gas's, close up)
  // (close to the star the magnetosphere's regions, on every face: the gas disk inside the dust's edge keeps its
  // quantity, on the layers' face its colour)
  vec4 m = uSliceQ > 0 && uMag > 0.0 && R < R_IN * 1.05 ? magFace(R, z, vec3(pc.xy, z), uSliceQ == 4) * vec4(1.0, 1.0, 1.0, uMag) : vec4(0.0);
  if (m.a > 0.0) return m;
  if (uSliceQ == 1) return vec4(0.92 * pow(tcolor(q.x), vec3(1.0 / 2.2)), smoothstep(-6.0, -4.5, q.z) * holeG);
  if (uSliceQ == 2) return vec4(cmap((q.y + 10.0) / 12.5, false), smoothstep(-10.5, -9.5, q.y));
  if (uSliceQ == 4) return layersFace(R, z, q) * vec4(1.0, 1.0, 1.0, hole);
  return vec4(0.0);
}

#ifdef FULL
// ---- The CO line (uLook 4; the page has called it the gas line since round 9, naming no molecule, the owner's choice; the
// model's line is CO's): a rotational line of carbon monoxide at millimetre wavelengths, as a channel map or as
// moment maps. The gas emits in local thermodynamic equilibrium at its temperature (the brightness temperature, in K,
// in the Rayleigh-Jeans limit). The line is optically thick: what is seen at a velocity comes from where the line's
// optical depth along the ray, at that velocity, reaches about one, high in the disk (with the line-centre opacity
// K_CO, the line's tau = 1 seen face-on lies at 3.6 H at 1 au, a little below the irradiation surface, where the gas is
// between the interior's temperature and the surface's). The local profile is a Gaussian of thermal and turbulent
// width (0.27 km/s at 100 K, so the full width is about the sound speed). The velocity along the ray (km/s, positive
// away from the observer) is the gas's: Keplerian rotation for a star of one solar mass, a little slower above the
// midplane and with the pressure gradient (the planet's gap makes it wiggle), the radial push of the planet's wake, the
// inflow of the accretion layer(s), and in the wind its flow along the field lines (from the wind's velocity map),
// weighted by the densities. The wind keeps CO_WIND of the CO (partly dissociated by the star's light; molecules
// survive in the irradiated wind, Mori, Bai & Tomida 2025). The pebble sheet absorbs the line from behind it (continuum
// subtracted: it does not add its own light).
//   The transfer (coMarch, generated in the script): the ray is sampled as in the other looks, and between two samples
// the gas changes linearly: its velocity sweeps from one sample's to the next (each velocity of the sweep gets an equal
// share of the opacity: the Gaussian averaged over the sweep, which is the Sobolev approximation where the sweep is
// wide, and the Gaussian itself where it is narrow), its opacity changes exponentially (the log mean), and the source
// function linearly in the optical depth. So the picture changes smoothly with where the samples fall (the march's
// jitter leaves no grain), and a line that sweeps past a velocity between two samples is not missed.
//   Channel map (uCoMode 0): the intensity averaged over a channel 0.25 km/s wide around uCoV (four velocities).
//   Moments (1: the mean velocity, 2: the integrated intensity): the same transfer on a grid of CO_N velocities spread
// evenly over those of the ray's gas (coWindow: from a coarser march, widened by 6.5 line widths, as far as the wings of
// a thick line reach), and summed as an observer sums a cube: moment 0 is the sum of the channels times their width,
// moment 1 their intensity-weighted mean velocity. Each velocity has its own optical depth, so gas behind at the same
// velocity is hidden and gas at other velocities is not (the surface where the line becomes thick differs from one
// velocity to the next). Moment 1 is left out where moment 0 is under CO_MASK of its base range (observers leave out
// what is under a few times the noise).
uniform int uCoMode;
uniform float uCoV;          // the channel's velocity (km/s)
uniform float uCoRange;      // the range of the moment-1 colours (km/s)
uniform float uCoK;          // the channel map's and moment 0's range, relative to CO_TB and CO_M0 (see coAim in the script)
uniform sampler2D uWindVel;  // the wind's velocity (see WINDMAP_FS)
const float K_CO = 6000.0, CO_WIND = 0.3, CO_TB = 220.0, CO_M0 = 900.0, CO_MASK = 0.02;
const vec2 CO_SH = vec2(-7.0, -10.0);   // the CO: shielded above e^-7 of the density, dissociated below e^-10
const int CO_Q = ${CO_Q};
// erf, to 1.5e-7 (Abramowitz & Stegun 7.1.26)
vec4 erfA(vec4 x){
  vec4 a = abs(x), t = 1.0 / (1.0 + 0.3275911 * a);
  return sign(x) * (1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a));
}
// the gap's slope d ln Σ / d ln R (for the pressure gradient)
float gapSlope(float R){ return gapT(R).y; }
// the gas at p for the CO line: CO density (relative), temperature (K), velocity along rd (km/s), line width (km/s:
// thermal and turbulent, sigma^2 = (0.025 sqrt(T))^2 + 0.011)
// (round 9) a ray's counts for diskRayProbe: iterations, gas samples, groups' updates (see CO_MARCH_GLSL)
float coNIt = 0.0, coNGas = 0.0, coNGrp = 0.0;
const float CO_SKIP = 6.0;   // (round 9, rec: a group of velocities this many widths outside a segment's sweep is skipped)
vec4 coGas(vec3 p, vec3 rd){
  coNGas += 1.0;
  float R = max(length(p.xy), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR), zh = p.z / H, az = abs(p.z);
  float cut = cutOut(R), gl = gapLn(R), phi = atan(p.y, p.x);
  float x = clamp(LNTAU1 - 1.25 * lnR - cut + gl - 0.5 * zh * zh, -30.0, 30.0);
  vec4 dm = diskMap(lnR, phi);
  // (the gas disk reaches the magnetosphere's edge MAG_RT, inside the dust's)
  float rhoD = exp(-lnR - cut + gl - 0.5 * zh * zh) * smoothstep(MAG_RT * 0.95, MAG_RT * 1.08, R) / (2.5066 * H) * dm.r * eddies(lnR, phi, zh).x;
  vec4 w = windMap(R, p.z);
  float r0w = exp(w.x), rhoW = exp(w.w) * gapFactor(r0w) * (p.z > 0.0 ? 1.0 : uWindLow) * smoothstep(R_IN, 2.5 * R_IN, r0w);
  float Td = tempAt(R, lnR, zh, x);   // (round 7: the model's temperature, see tempAt)
  vec2 er = vec2(cos(phi), sin(phi)), ep = vec2(-er.y, er.x);
  float vk = 29.78 * inversesqrt(R), h = H / R, cs = h * vk;
  // the disk: Keplerian at height z, (R/r)^3/2, with the pressure gradient (d ln P / d ln R = d ln Σ / d ln R - 7/4)
  float vphi = vk * pow(1.0 + zh * zh * h * h, -0.75) * (1.0 + 0.5 * h * h * (-1.0 - P_OUT * cut + gapSlope(R) - 1.75));
  // the planet's wake pushes the gas outward with its density excess (beyond the turbulent inner disk, where the disk
  // map's gas factor is the wake's); the accretion layer(s) flow inward
  float vR = R > 0.6 ? 0.5 * cs * (dm.r - 1.0) : 0.0;
  float zu = (zh - zAccH(R)) / ACC_W, zl = (zh + zAccLow(R, asymF())) / ACC_W;
  vR -= accAmp(R) * cs * (uAcc.x * uAccV.x * exp(-0.5 * zu * zu) + uAcc.y * uAccV.y * exp(-0.5 * zl * zl));
  vec3 v = vec3(vR * er + vphi * ep, 0.0);
  // (the components: the disk's gas and the wind's, each with its button; the velocity and the temperature are their
  // density-weighted means, taken before the outer fade, which must not scale them)
  // Where the line comes from. CO needs shielding from the star's ultraviolet: where the gas is thin (the disk's upper
  // layers far out, its tapering edge, the wind high up) it is dissociated, faded out from ln rho = CO_SH.x to CO_SH.y
  // (rho relative to about 13 at 1 au in the midplane: 1e-3 to 5e-5), which gives the disk a CO surface at z/R of about
  // 0.15-0.2 and an outer edge near 35 au; and the whole lies inside an ellipsoid within the marched cylinder, (R/RB)^2
  // + (z/ZB)^2 from 0.75 to 0.98. The line is so thick that the fade by radius alone used before (33-39 au) left the
  // cylinder's walls and caps in the moment maps.
  float qE = length(vec2(R / RB_OBS, p.z / ZB_OBS));
  float rD = rhoD * uComp.x * smoothstep(CO_SH.y, CO_SH.x, log(max(rhoD, 1e-30)));
  float rW = CO_WIND * rhoW * uComp.w * smoothstep(CO_SH.y, CO_SH.x, log(max(rhoW, 1e-30)));
  float rhoCO = (rD + rW) * (1.0 - smoothstep(0.75, 0.98, qE)), T = Td;
  if (rW > 1e-3 * rD) {
    vec4 wv = texture(uWindVel, vec2((0.5 * log(R * R + az * az) - LNW_MIN) / LNW_SPAN, 0.5 + atan(p.z, R) / PI));
    float vk0 = 29.78 * inversesqrt(r0w);
    vec3 vw = vec3((wv.x * er + wv.y * ep) * vk0, sign(p.z) * wv.z * vk0);
    float rS = max(rD + rW, 1e-30);
    v = (rD * v + rW * vw) / rS;
    T = (rD * Td + rW * tSurf(sqrt(R * R + az * az))) / rS;   // (the wind's gas at the superheated grains' temperature in full starlight)
  }
  return vec4(rhoCO, T, dot(v, rd), sqrt(0.000625 * T + 0.011));
}
// (round 9, at its end) The moments are drawn in passes (CO_PASSES in the script): each marches CO_P adjacent groups of
// four of the CO_N velocities spread evenly over the ray's window (coGrid), and adds its sums (the intensities, and the
// intensities times the velocities) to those of the passes before (uCoAcc, a target of floats per pixel, read by the
// next pass); the first pass finds the window too (coWindow), so that every pass uses the same velocities; the last,
// the composite, turns the sums into moments 0 and 1. One march kept 24 velocities' intensities and transmissions live
// through the whole ray: on the M1 Max it cost 67.6 us per gas sample at the slowest ray edge-on, against 16.5 with 4,
// 21.7 with 8 and 23.4 with 12 (the GPU's occupancy falls with the registers it needs; the gas samples are the same).
// The velocities of group g: the window wv cut into CO_N equal parts, at their middles (uCoDith: an offset of the grid in
// parts, 0; round 10 may move it frame to frame, here only)
vec4 coGrid(vec2 wv, int g){ return wv.x + (wv.y - wv.x) / float(4 * CO_Q) * (4.0 * float(g) + vec4(0.5, 1.5, 2.5, 3.5) + uCoDith); }
// one group of four velocities, given (the channel map's; a group of the moments' grid where a pass takes one): resumable (round
// 10a, dev.6, see CO_MARCHK_GLSL), and drawn whole through the same function
${CO_MARCHK_GLSL}
// three adjacent groups of the moments' grid, from g0: the sum of their intensities, and of the intensities times the velocities
${CO_MARCH_GLSL('coMarch3', 3, 'vec2', 'vec2 wv, int g0', 'coGrid(wv, g0 + q)',
  'float s0 = 0.0, s1 = 0.0; for (int q = 0; q < 3; q++) { s0 += dot(I[q], vec4(1.0)); s1 += dot(I[q], coGrid(wv, g0 + q)); } return vec2(s0, s1);')}
// (the channel map's four velocities: a channel 0.25 km/s wide around v; its intensity their mean)
vec4 coChanVel(float v){ return v + vec4(-0.09375, -0.03125, 0.03125, 0.09375); }
// (the sums kept scaled, so that they also fit half floats where full ones cannot be drawn into: CO_SUM)
const vec2 CO_SUM = vec2(1.0 / float(4 * CO_Q), 1.0 / (50.0 * float(4 * CO_Q)));
// the velocities the moments need along a ray: those of its gas with line opacity in front of the opaque pebble sheet,
// from a march three times as coarse, widened by 6.5 line widths (and a little for what the coarse march may miss)
// (round 10a, dev.6: resumable, as the march (see CO_MARCHK_GLSL): its place t, the velocities lo, hi and the widest width w so
// far, the step's count and the sheet; true when done. coWindowOf: the window from them)
bool coWindowK(vec3 ro, vec3 rd, vec2 b, float tCross, inout float t, inout float lo, inout float hi, inout float w, inout float iF, inout bool sheetDone, int budget){
  int i0 = int(iF);
  for (int n = 0; n < budget; n++) {
    int i = i0 + n;
    if (i >= 32768 || t >= b.y) { iF = float(i); return true; }
    vec3 p = ro + rd * t;
    float R = max(length(p.xy), 0.05), Hs = H0 * pow(R, 1.25), az = abs(p.z);
    float ds = 3.0 * clamp(max(0.4 * Hs, (az > 4.5 * Hs ? 0.25 : 0.18) * az), 0.004, max(0.4, 0.05 * length(p)));
    ds = min(ds, b.y - t);
    vec3 pm = ro + rd * (t + 0.5 * ds);
    vec4 g = coGas(pm, rd);
    if (K_CO * g.x * ds > 1e-3 && length(pm.xy) > MAG_RT * 0.9) { lo = min(lo, g.z); hi = max(hi, g.z); w = max(w, g.w); }
    if (!sheetDone && t + ds >= tCross) {
      vec3 c0 = vec3(0.0), tr0 = vec3(1.0);
      sheet(ro + rd * tCross, rd, c0, tr0);
      sheetDone = true;
      if (tr0.r < 0.01) { iF = float(i); return true; }
    }
    t += ds;
  }
  iF = float(i0 + budget);
  return false;
}
vec2 coWindowOf(float lo, float hi, float w){
  if (lo > hi) return vec2(0.0, -1.0);
  float m = 6.5 * w + 0.1 + 0.03 * max(abs(lo), abs(hi));
  return vec2(lo - m, hi + m);
}
// a pass of the moments (uCoPass 2, from group uCoG0): the window (found by the first pass) and the sums so far, with
// this pass's added
// (the full tier's pass of three groups; one group a pass, the cheaper tier's, goes through coRun: see below)
vec4 coPass(vec3 ro, vec3 rd, vec2 b, float tCross, float jitter, bool hit){
  vec4 a = uCoG0 > 0 ? texelFetch(uCoAcc, ivec2(gl_FragCoord.xy), 0) : vec4(0.0, -1.0, 0.0, 0.0);
  if (hit && uCoG0 == 0) { float t = b.x, lo = 1e9, hi = -1e9, w = 0.0, iF = 0.0; bool sh = tCross <= b.x || tCross >= b.y; coWindowK(ro, rd, b, tCross, t, lo, hi, w, iF, sh, 1 << 30); a.xy = coWindowOf(lo, hi, w); }
  if (hit && a.y > a.x) a.zw += coMarch3(ro, rd, b, tCross, jitter, a.xy, uCoG0) * CO_SUM;
  return a;
}
// the moments from the sums (the composite): moment 0 in K km/s, moment 1 in km/s
vec4 coMomentsOf(vec4 a){
  if (a.y <= a.x || a.z <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 s = a.zw / CO_SUM;
  return vec4(s.x * (a.y - a.x) / float(4 * CO_Q), s.y / s.x, 0.0, 1.0);
}
// the CO picture for a ray within the marched cylinder, in display values
vec3 coPicture(vec4 q){
  if (uCoMode == 0) return cmap(sqrt(q.x / (CO_TB * uCoK)), true);
  if (uCoMode == 2) return cmap(sqrt(q.x / (CO_M0 * uCoK)), true);
  // moment 1: blue (toward us) through grey to red (away), where moment 0 is bright enough (in full, as observers draw
  // it; the grey a middle one, so that a disk seen face-on, all near 0 km/s, is not a white glare)
  float v = clamp(q.y / uCoRange, -1.0, 1.0);
  vec3 c = v < 0.0 ? mix(vec3(0.60, 0.61, 0.64), vec3(0.20, 0.36, 0.92), -v) : mix(vec3(0.60, 0.61, 0.64), vec3(0.88, 0.16, 0.12), v);
  return c * smoothstep(CO_MASK, 1.5 * CO_MASK, q.x / CO_M0);
}
#endif
#ifdef FULL
// ---- The star's magnetosphere (MAG in the script), close up ----
const float MAG_R = ${G(MAG.RT * (1 + MAG.DL) * 1.03)};
const float GM_V = 0.274156;            // G M in au^3 s^-2 on the model's clock (an orbit at 1 au takes 12 s)
const int MAG_N = 64;                   // samples through the magnetosphere's sphere, spaced as the distance from the star (see magLight)
const vec2 MAG_CELLS = vec2(10.0, 2.0); // the columns' fluctuations: cells around the axis and across the bundle of lines
const float MAG_PULSE = 0.005, MAG_FL = 2.2;   // their time (s of the model's clock; the fall takes 0.024 s) and contrast
// (the colours are a choice for the picture: the falling gas of several thousand K shines in hydrogen lines, red like
// H-alpha; the shock where it lands heats the gas to about a million K, which shines in ultraviolet and X-rays: violet)
const vec3 MAG_COL = vec3(1.0, 0.36, 0.50);    // the curtains' glow
const vec3 HOT_COL = vec3(0.76, 0.66, 1.0);    // the shocks where they land
const vec3 CAV_COL = vec3(0.55, 0.45, 1.0);    // the closed magnetosphere's edge, faintly
const float MAG_COLB = 9000.0, MAG_SURF = 3.0, MAG_GASB = 1.2, MAG_CAVB = 6.0;   // brightness: the curtains, the star's surface, the gas disk, the closed region's edge
// The accretion curtains' light at p, per unit length (the funnel flow of Hartmann, Hewett & Calvet 1994): the gas
// leaving the ring at the disk's inner edge along the closed lines L = MAG_RT to MAG_RT (1 + MAG_DL) and falling freely
// onto the star, toward the north magnetic pole where the magnetic azimuth is near 0 (the side the dipole tilts to) and
// toward the south one on the other side: two curtains, thin across the lines (sin across the bundle) and broad in
// azimuth (magAz: arcs about 110 degrees across at half their density), that turn with the star; lifting off the disk
// within about 15 degrees of the magnetic equator. Inside the curtains (L < MAG_RT) the closed magnetosphere holds no
// disk (the cavity); its edge, the last closed lines, glows faintly (CAV_COL) so that its extent shows. The density along a flux tube, rho ∝ B / v (the mass flux
// rho v A is the same through the tube, whose cross-section A ∝ 1 / B), with B ∝ r^-3 (1 + 3 cos^2 theta)^1/2 and v the
// free fall from rest at r = L (floored at 0.1 of its value at the star); its light ∝ rho^1.2 (recombination light goes
// as rho^2; less, so that the stream shows up to the disk's edge: per unit length it is brightest at its foot). The fluctuations are carried at the free-fall speed: the noise is taken at the
// moment the gas left the edge (uMagT - t_ff, t_ff the radial free fall from L to r; along the curved line it is a
// little longer), in the star's frame.
vec3 magColumn(vec3 p){
  float r = length(p);
  if (r < MAG_RS || r > MAG_R) return vec3(0.0);
  float cz = dot(p, uMagAxis) / r, s2 = max(1.0 - cz * cz, 1e-5), L = r / s2, u = (L / MAG_RT - 1.0) / MAG_DL;
  if (u >= 1.0) return vec3(0.0);
  if (u <= 0.0) return u < -0.8 ? vec3(0.0) : (uLook == 0 ? MAT_MAG : CAV_COL) * (MAG_CAVB * exp(u * MAG_DL / 0.06) * smoothstep(0.0, 0.15, abs(cz)) * smoothstep(MAG_RS, 1.5 * MAG_RS, r));   // (the closed region's edge)
  float phm = atan(dot(p, cross(uMagAxis, uMagE1)), dot(p, uMagE1)), dph = cz > 0.0 ? phm : PI - abs(phm);   // (from the curtain's middle)
  float w = magAz(dph) * sin(PI * u) * smoothstep(0.08, 0.3, abs(cz));   // (lifting off the disk near the magnetic equator)
  if (w < 1e-3) return vec3(0.0);
  float x = min(s2, 0.9999), vt = sqrt(2.0 * GM_V / L), v = vt * sqrt(1.0 / x - 1.0), vs = vt * sqrt(L / MAG_RS - 1.0);   // (x = r / L)
  float rho = sqrt(1.0 + 3.0 * cz * cz) / (x * x * x) * vs / max(v, 0.1 * vs);
  float tff = sqrt(L * L * L / (2.0 * GM_V)) * (sqrt(x * (1.0 - x)) + acos(sqrt(x)));
  float n = vnoise3(vec3(phm / TAU * MAG_CELLS.x, u * MAG_CELLS.y, (uMagT - tff) / MAG_PULSE), MAG_CELLS.x);
  return (uLook == 0 ? MAT_CURT : MAG_COL) * (MAG_COLB * w * pow(rho / 500.0, 1.2) * exp(MAG_FL * n - 0.0171 * MAG_FL * MAG_FL));
}
// the star's surface at the unit normal nrm: the photosphere (limb darkened) and the hot spots where the curtains land:
// arcs (parts of rings) at the colatitudes where the lines L meet the surface (sin^2 theta = MAG_RS / L), as wide in
// azimuth as the curtains, turning with the star
vec3 magSurface(vec3 nrm, vec3 rd){
  float mu = max(dot(nrm, -rd), 0.0), cz = dot(nrm, uMagAxis), s2 = max(1.0 - cz * cz, 1e-5), u = (MAG_RS / s2 / MAG_RT - 1.0) / MAG_DL;
  float phm = atan(dot(nrm, cross(uMagAxis, uMagE1)), dot(nrm, uMagE1)), dph = cz > 0.0 ? phm : PI - abs(phm);
  float spot = smoothstep(0.05, 0.4, magAz(dph)) * smoothstep(-0.25, 0.15, u) * (1.0 - smoothstep(0.85, 1.25, u));
  return mix(STARCOL, HOT_COL * 2.8, spot) * MAG_SURF * (0.4 + 0.6 * mu);
}
// the dust-free gas disk between the magnetosphere's edge MAG_RT and the dust's sublimation radius R_IN, where the ray
// crosses the midplane (cosi: |rd.z|): hot gas, about 1500 K, glowing faintly (its emission per unit area over the
// cosine of the crossing, at most 20 times)
// (its inner edge at the truncation, the wall the curtains rise from, brighter: where the disk ends shows)
vec3 magGasDisk(float R, float cosi){
  // (round 7: lowered by the planets' gaps, which reach it from planets close to the star)
  float a = smoothstep(MAG_RT * 0.97, MAG_RT * 1.05, R) * (1.0 - smoothstep(R_IN * 0.85, R_IN * 1.25, R)) * gapFactor(R);
  float wall = 1.0 + 2.5 * exp(-pow((R - MAG_RT * 1.04) / (0.05 * MAG_RT), 2.0));
  return a > 0.0 ? MAG_GASB * (uLook == 0 ? MAT_DISK : tcolor(1500.0)) * a * wall / max(cosi, 0.05) : vec3(0.0);   // (round 8: the disk's material in the model's look)
}
// The magnetosphere laid in at the star's distance, as the star's light is (the disk in front dims it): the columns
// (optically thin; not in the part cut away) and the star's surface (whole, also with the cutaway), which hides what lies
// behind it. As it fades in (uMag) it takes over from the star's point-like glow.
// (Disk Lab v2: the gas disk inside the dust's edge is laid in where the ray crosses the midplane, in midplaneAt. Laid
// in here, at the ray's closest approach to the star, it came in front of the far side's dusty disk and behind the near
// side's, so that it was cut along the line through the star across the view. The columns' samples are spaced as the
// distance from the star, uniformly in asinh((t - tc) / b) about the closest approach tc at the impact parameter b: the
// curtains narrow toward the star, and evenly spaced samples (48 across the sphere) aliased there into a mesh.)
// (colC: the light kept through the automatic exposure, added to col and also gathered there, so that the measurement
// leaves out the pixels it dominates)
// (Round 8: the light only, magLight, evaluated once after the march, with the transmission the march had at the star,
// trS; the march dims what lies behind the star there itself (see starHit). magLayer was inlined at the three places that
// laid it in, two inside the march: the march's registers grew with it, and next to the star it took 35-45 ms of a frame
// of about 90 at scale 0.5, 10 ms in round 7's smaller shader)
vec3 magLight(vec3 ro, vec3 rd, float jitter, vec3 starGlow, float tCut, vec2 tSkip){
  if (uMag <= 0.0) return starGlow;
  vec2 bs = boundsSphere(ro, rd, MAG_RS), bm = boundsSphere(ro, rd, MAG_R);
  bool hit = bs.y > bs.x;   // (the star is not cut away)
  vec3 em = vec3(0.0);
  if (bm.y > bm.x) {
    float t0 = max(bm.x, tCut), t1 = hit ? bs.x : bm.y;
    if (t1 > t0) {
      float tc = -dot(ro, rd), bi = max(length(ro + rd * tc), 0.5 * MAG_RS);
      float s0 = asinh((t0 - tc) / bi), dsn = (asinh((t1 - tc) / bi) - s0) / float(MAG_N);
      for (int i = 0; i < MAG_N; i++) {
        float sn = s0 + (float(i) + jitter) * dsn, t = tc + bi * sinh(sn);
        if (t > tSkip.x && t < tSkip.y) continue;
        em += magColumn(ro + rd * t) * (bi * cosh(sn) * dsn);
      }
    }
  }
  float tz = abs(rd.z) > 1e-6 ? -ro.z / rd.z : -1.0;
  vec3 surf = hit ? magSurface(normalize(ro + rd * bs.x), rd) * uStarK : vec3(0.0);
  if (uLook > 1) em = vec3(0.0);   // (the columns and the gas disk glow in the model's look and in scattered light only)
  em *= gasL();                    // (round 7: they are gas)
  return uMag * (em * uStarK + surf) + (hit ? 1.0 - uMag : 1.0) * starGlow;   // (uStarK: the magnetosphere keeps its own light through the automatic exposure)
}
// the transmission behind the star (what it hides as the magnetosphere shows)
float starHit(vec3 ro, vec3 rd){ vec2 bs = boundsSphere(ro, rd, MAG_RS); return uMag > 0.0 && bs.y > bs.x ? 1.0 - uMag : 1.0; }
// (round 10a) The star reached: the light kept from the star and the magnetosphere (magLight) laid in now, with the
// transmission here, and what lies behind the star dimmed. It was gathered after the march with the transmission kept at
// the star (trS), which the march in kicks has no room to carry (see SPLIT): the same light, added to col before what lies
// behind the star rather than after it, a rounding's difference at most
void starAt(vec3 ro, vec3 rd, float jitter, vec3 starGlow, float tCut, vec2 tSkip, inout vec3 col, inout vec3 tr, inout float cL){
  vec3 kept = tr * magLight(ro, rd, jitter, starGlow, tCut, tSkip);
  tr *= starHit(ro, rd);
  col += kept; cL += dot(kept, LUMW);
}
#endif
// The midplane where the ray crosses it: the dust-free gas disk inside the dust's edge (with the magnetosphere), then
// the pebble sheet.
// (round 10a: cL, the luminance of the light kept through the automatic exposure, see aeW: it was colC, its colour, which the
// march in kicks has no room to carry)
void midplaneAt(vec3 ro, vec3 rd, float tz, inout vec3 col, inout vec3 tr, inout float cL){
#ifdef FULL
  if (uMag > 0.0 && uLook <= 1) { vec3 e = tr * (uMag * uStarK * gasL()) * magGasDisk(length((ro + rd * tz).xy), abs(rd.z)); col += e; cL += dot(e, LUMW); }
#endif
  sheet(ro + rd * tz, rd, col, tr);
}
#ifdef FULL
// The cut face seen through the point fc (in pixels of uRes): premultiplied, with its fade (uSliceFace); none where the
// ray does not leave the part cut away there. The face alone is drawn at the screen's resolution (faceT in the script,
// laid over the volume by SHOW_FS), so that its colours' boundaries and its edges are as sharp as the screen whatever
// the render scale of the volume: uFacePass 1, one sample per pixel (into faceA); 2, from it, four samples on a rotated
// grid where a pixel differs from one of its four neighbours (a boundary between colours, an edge), else the one.
uniform int uFacePass;
uniform sampler2D uFaceA;
uniform int uFaceRdy;     // 1: faceA holds the face of this picture (drawn before the volume)
uniform vec2 uFaceRes;    // its size (the screen's pixels)
// A camera outside the cut-away wedge can still look through it and see its exit face. Only the kept foreground,
// up to the wedge's entrance tIn, veils that face. Reuse the volume's extinction and analytic pebble sheet; the wind
// in the wedge is behind the displayed quantity, as it is for a camera already inside it.
float faceForeground(vec3 ro, vec3 rd, float tIn){
  if (tIn <= 0.0) return 1.0;
  vec2 bs = boundsSphere(ro, rd, MAG_RS);
  if (bs.y > bs.x && bs.x < tIn) return 0.0;
  vec3 tr = vec3(1.0), col = vec3(0.0);
  float tc = abs(rd.z) > 1e-6 ? -ro.z / rd.z : -1.0;
  if (tc > 0.0 && tc < tIn) sheet(ro + rd * tc, rd, col, tr);
  vec2 b = boundsCyl(ro, rd);
  float t = b.x, end = min(b.y, tIn);
  vec3 wq = vec3(99.0);
  float xp = lnTauStar(ro + rd * t);
  for (int i = 0; i < 320; i++) {
    if (t >= end || max(tr.r, max(tr.g, tr.b)) < 0.01) break;
    vec3 p = ro + rd * t;
    float Hs = H0 * pow(max(length(p.xy), 0.2), 1.25);
    float ds = min(end - t, clamp(max(0.4 * Hs, 0.18 * abs(p.z)), 0.004, max(0.4, 0.05 * length(p))));
    vec3 em, ex, skin; float x, wl;
    sampleDisk(ro + rd * (t + 0.5 * ds), rd, xp, ds, wq, em, ex, skin, x, wl);
    tr *= exp(-ex * ds); xp = x; t += ds;
  }
  return dot(tr, vec3(0.2126, 0.7152, 0.0722));
}
vec4 faceAt(vec2 fc){
  vec2 uv = (fc / uRes) * 2.0 - 1.0;
  vec3 rd = normalize(uBasis[2] + uTanHalf * (uv.x * (uRes.x / uRes.y) * uBasis[0] + uv.y * uBasis[1]));
  vec2 cs = cutSpan(uCam, rd);
  if (uSlice == 0 || uSliceFace <= 0.0 || !(cs.x < cs.y && cs.y > 0.0 && cs.y < 1e8) || !facePainted()) return vec4(0.0);
  vec4 f = sliceFace(uCam + rd * cs.y);
  if (f.a <= 0.0) return vec4(0.0);
  f.a *= faceForeground(uCam, rd, cs.x);
  float a = f.a * uSliceFace;
  return vec4(f.rgb * a, a);
}
#endif
#ifdef FULL
// (round 10a) THE MARCH IN KICKS (the script's SPLIT; DESIGN.md, section 23, 光線を区切って進める). The owner's iPhone reset its
// GPU ("firmware-detected lockup") while the visible look was drawn; its slowest rays take some 720 steps of the march, about
// 55 ms on the M1 Max, and a pixel's work is not shared out: the GPU holds a tile until its slowest ray is done. Drawn in
// kicks, each draw advances every ray of a band by at most uKickK steps' worth of work (KW_), the ray's state kept in a float
// array of four layers (the same four numbers a layer, whichever stage the ray is at), read in the next kick: no ray holds
// the GPU longer than a kick, whatever its length. Every ray takes the same steps in the same order as when it is drawn in
// one go (uSplit 0, the same code with an unbounded budget), so the picture is the same. The layers: 0 col.rgb, t (in the
// part cut away: its march's t); 1 tr.rgb, xPrev (its xPrev); 2 wq (its wq), gEnvAcc; 3 i (the stage's step), the stage
// and the marks (see PH_, F_; and the cut's step j), cL, ts (the place of the cut's last sample). A ray done holds its
// display value and the exposure's weight in layer 0, and the kick it ended in (uKickN) in layer 3; the next kick writes it
// into the other set too, and the kicks after that draw nothing there (both sets hold it), so a kick that draws no pixel
// at all (the script's occlusion query) says the band is done. (A mark 'copied' carried in the state was wrong: the set
// written by the kick a ray ended in kept it unmarked, and every other kick copied it again: the band was never seen done)
uniform int uSplit;        // 0: the ray drawn whole, as before; 1: a kick; 2: the band's picture, from the state of its rays done
uniform int uKick0;        // 1: the band's first kick (the state made here, not read)
uniform float uKickK;      // the work a kick may do, in steps of the march (see KW_)
uniform float uKickN;      // the kick's count in its band (0 for its first)
uniform float uRowOff;     // the band's first row in the volume (a kick draws into the band's rows of the state)
uniform highp sampler2DArray uState;
layout(location = 1) out vec4 fragS1;
layout(location = 2) out vec4 fragS2;
layout(location = 3) out vec4 fragS3;
// (round 10a, dev.6) The gas line's march of one group, drawn whole (uSplit 0) or in kicks (1): the channel map (uCoMode 0), the
// window (uCoPass 4: in kicks, a pass of its own before the groups'; drawn whole, the first group's pass finds it too) and a
// pass of one group (uCoPass 2, the cheaper tier's). Its state in kicks: the window's search, layer 0 its place and velocities
// (t, lo, hi, w); the march, layer 0 the intensities, 1 the transmissions, 2 t, dsP, kP, sP, 3 the step's count, the stage
// (PH_CO_WIN, PH_CO_MARCH) and the sheet, uP, wP. Returns true where a kick left the ray going (its state written); otherwise
// outC: the channel's colour, or the pass's window and sums. The two marches each called from one place only, whole or not:
// the same code, the same picture in kicks
const int PH_CO_WIN = 9, PH_CO_MARCH = 10;
float coChanI = 0.0;   // (the channel's intensity, for diskRayProbe)
bool coRun(vec3 ro, vec3 rd, vec2 bc, float tCross, float jitter, bool hit, vec3 bgD, out vec4 outC){
  bool kick = uSplit == 1, chan = uCoMode == 0;
  vec4 a = vec4(0.0, -1.0, 0.0, 0.0);
  if (!chan && uCoPass == 2 && (kick || uCoG0 > 0)) a = texelFetch(uCoAcc, ivec2(gFc), 0);
  vec4 I0 = vec4(0.0), Tr0 = vec4(1.0);
  float t = 0.0, dsP = 1e9, kP = 0.0, sP = 0.0, uP = 0.0, wP = 0.0, iF = 0.0, lo = 1e9, hi = -1e9, w = 0.0;
  bool sheet = false;
  int ph = PH_CO_MARCH;
  outC = chan ? vec4(bgD, 1.0) : a;
  if (!kick || uKick0 == 1) {
    if (!hit) return false;
    if (!chan && (uCoPass == 4 || (!kick && uCoG0 == 0))) { ph = PH_CO_WIN; t = bc.x; sheet = tCross <= bc.x || tCross >= bc.y; }
    else if (!chan && a.y <= a.x) return false;
    else coMarchK0(ro, rd, bc, tCross, I0, Tr0, t, dsP, kP, sP, uP, wP, iF, sheet);
  } else {
    ivec2 sp = ivec2(gl_FragCoord.xy);
    vec4 s0 = texelFetch(uState, ivec3(sp, 0), 0), s1 = texelFetch(uState, ivec3(sp, 1), 0), s2 = texelFetch(uState, ivec3(sp, 2), 0), s3 = texelFetch(uState, ivec3(sp, 3), 0);
    int pk = int(s3.y);
    ph = (pk / 2048) % 16; sheet = (pk % 2048) != 0; iF = s3.x;
    if (ph == PH_CO_WIN) { t = s0.x; lo = s0.y; hi = s0.z; w = s0.w; }
    else { I0 = s0; Tr0 = s1; t = s2.x; dsP = s2.y; kP = s2.z; sP = s2.w; uP = s3.z; wP = s3.w; }
  }
  int budget = kick ? int(uKickK) : (1 << 30);
  if (ph == PH_CO_WIN) {
    if (!coWindowK(ro, rd, bc, tCross, t, lo, hi, w, iF, sheet, budget)) {
      fragColor = vec4(t, lo, hi, w); fragS1 = vec4(0.0); fragS2 = vec4(0.0); fragS3 = vec4(iF, float(PH_CO_WIN * 2048 + (sheet ? 1 : 0)), 0.0, 0.0);
      return true;
    }
    a = vec4(coWindowOf(lo, hi, w), 0.0, 0.0);
    outC = a;
    if (uCoPass == 4 || a.y <= a.x) return false;
    // (drawn whole: the first group's march now, from the window)
    ph = PH_CO_MARCH; coMarchK0(ro, rd, bc, tCross, I0, Tr0, t, dsP, kP, sP, uP, wP, iF, sheet);
    budget = 1 << 30;
  }
  vec4 vel = chan ? coChanVel(uCoV) : coGrid(a.xy, uCoG0);
  if (!coMarchK(ro, rd, bc, tCross, jitter, vel, I0, Tr0, t, dsP, kP, sP, uP, wP, iF, sheet, budget)) {
    fragColor = I0; fragS1 = Tr0; fragS2 = vec4(t, dsP, kP, sP); fragS3 = vec4(iF, float(PH_CO_MARCH * 2048 + (sheet ? 1 : 0)), uP, wP);
    return true;
  }
  if (chan) { coChanI = dot(I0, vec4(0.25)); outC = vec4(max(coPicture(vec4(coChanI, 0.0, 0.0, 1.0)), bgD), 1.0); }
  else { a.zw += vec2(dot(I0, vec4(1.0)), dot(I0, vel)) * CO_SUM; outC = a; }
  return false;
}
#endif
void main(){
  gFc = gl_FragCoord.xy;
#ifdef FULL
  // (the face alone, see faceAt)
  if (uFacePass == 1) { fragColor = faceAt(gl_FragCoord.xy); return; }
  if (uFacePass == 2) {
    ivec2 ip = ivec2(gl_FragCoord.xy), mx = textureSize(uFaceA, 0) - 1;
    vec4 c0 = texelFetch(uFaceA, ip, 0);
    vec4 d = max(max(abs(texelFetch(uFaceA, min(ip + ivec2(1, 0), mx), 0) - c0), abs(texelFetch(uFaceA, max(ip - ivec2(1, 0), ivec2(0)), 0) - c0)),
                 max(abs(texelFetch(uFaceA, min(ip + ivec2(0, 1), mx), 0) - c0), abs(texelFetch(uFaceA, max(ip - ivec2(0, 1), ivec2(0)), 0) - c0)));
    if (max(max(d.r, d.g), max(d.b, d.a)) < 0.02) { fragColor = c0; return; }
    vec2 fc = gl_FragCoord.xy;
    fragColor = 0.25 * (faceAt(fc + vec2(0.125, 0.375)) + faceAt(fc + vec2(0.375, -0.125)) + faceAt(fc + vec2(-0.125, -0.375)) + faceAt(fc + vec2(-0.375, 0.125)));
    return;
  }
  // (round 10a, see SPLIT: the band's picture, drawn into the volume's target from the state its rays left; and a kick's
  // pixel, in the band's rows of the state, at its row of the volume)
  if (uSplit == 2) { fragColor = texelFetch(uState, ivec3(ivec2(gl_FragCoord.xy - vec2(0.0, uRowOff)), 0), 0); return; }
  // (a ray done, in a kick: written into this set in the kick after the one it ended in, then nothing more, see above; here,
  // before any of the ray's making, which every pixel of a band paid in every kick: 10 to 16 ms a kick over 576 x 349 pixels
  // on the M1 Max, the band's rays mostly done)
  if (uSplit == 1 && uKick0 == 0) {
    ivec2 sp = ivec2(gl_FragCoord.xy);
    vec4 s3 = texelFetch(uState, ivec3(sp, 3), 0);
    if ((int(s3.y) / 2048) % 16 == PH_DONE) {
      if (uKickN - s3.x >= 2.0) discard;
      fragColor = texelFetch(uState, ivec3(sp, 0), 0); fragS1 = texelFetch(uState, ivec3(sp, 1), 0); fragS2 = texelFetch(uState, ivec3(sp, 2), 0); fragS3 = s3;
      return;
    }
  }
  gFc.y += uRowOff;
#endif
  vec2 uv = ((gFc + uJit.xy) / uRes) * 2.0 - 1.0, uv0 = (gFc / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uBasis[2] + uTanHalf * (uv.x * aspect * uBasis[0] + uv.y * uBasis[1]));
  vec3 ro = uCam;
  gWindNear = mix(WIND_NEAR, 1.0, smoothstep(22.0, 68.0, length(uCam)));   // (round 9: per ray, see gWindNear)
  float roLen = max(length(ro), 0.05);   // (round 9: per ray, for the far wind's steps)
  float pixA = 2.0 * uTanHalf / uRes.y;   // angular size of a render pixel

  // the star is a point: drawn with a small screen-space profile so it stays crisp at any size
  vec3 sv = vec3(dot(-ro, uBasis[0]), dot(-ro, uBasis[1]), dot(-ro, uBasis[2]));
  vec2 spx = (vec2(sv.x / (sv.z * uTanHalf * aspect), sv.y / (sv.z * uTanHalf)) * 0.5 + 0.5) * uRes;
  float dpx = length(gFc - spx) / uPx;
  vec3 starGlow = STARCOL * (40.0 * exp(-dpx * dpx / 1.2) + 0.4 * exp(-dpx / 2.0) + 0.02 / (1.0 + dpx * dpx / 50.0)) * uStar;
  float tStar = max(-dot(ro, rd), 0.0);

  // the cutaway: from a camera in the part cut away the ray enters the kept part at tCut, where it meets a cut face
  // (rays that never reach it see only the sky); the face hides what lies behind it where it is opaque. While the
  // planes sweep they may pass the camera: from inside the kept part nothing is cut in front, and a ray that crosses
  // the part cut away skips it (tSkip) or, when it leaves the kept part for good, ends there (the disk, that is: the
  // wind and the envelope there are drawn all the same, see cutWind). The face itself is laid
  // over at the screen's resolution (faceAt); here its opacity counts for the exposure's measurement, and what lies
  // behind it is left out where it is opaque at the pixel and a pixel around (so that the volume, upsampled to the
  // screen, has no dark rim along the face's edges).
  float tCut = 0.0, tEnd = 1e9;
  vec2 tSkip = vec2(1e9);
  vec4 face = vec4(0.0);
  bool faceOpaque = false;
#ifdef FULL
  if (uSlice != 0) {
    vec2 cs = cutSpan(ro, rd);
    if (cs.x < cs.y && cs.y > 0.0) {
      if (cs.x <= 0.0) {
        tCut = cs.y;
        if (tCut < 1e8 && uSliceFace > 0.0 && facePainted()) {
          face = sliceFace(ro + rd * tCut); face.a *= uSliceFace;
          // (opaque over the screen's pixels this one reaches when upsampled, a render pixel around, and one more screen
          // pixel, where the face's edge is smoothed: faceA at the corners of that square, which a straight edge across it
          // cannot all miss)
          if (face.a >= 0.999 && uFaceRdy != 0) {
            vec2 c = gFc * uFaceRes / uRes, sc = uFaceRes / uRes + 1.0;
            ivec2 mx = ivec2(uFaceRes) - 1;
            faceOpaque = min(min(texelFetch(uFaceA, clamp(ivec2(c - sc), ivec2(0), mx), 0).a, texelFetch(uFaceA, clamp(ivec2(c + vec2(sc.x, -sc.y)), ivec2(0), mx), 0).a),
                             min(texelFetch(uFaceA, clamp(ivec2(c + vec2(-sc.x, sc.y)), ivec2(0), mx), 0).a, texelFetch(uFaceA, clamp(ivec2(c + sc), ivec2(0), mx), 0).a)) >= 0.999;
          }
        }
      } else if (cs.y > 1e8) tEnd = cs.x;
      else tSkip = cs;
    }
  }
#endif

  // (b0: the cylinder, the observed looks' smaller one (round 8, see RB_OBS); b: its part kept)
  vec2 b0 = uLook == 0 ? boundsCyl(ro, rd) : boundsCylRZ(ro, rd, RB_OBS, ZB_OBS), b = b0;
  b.x = max(b.x, tCut); b.y = min(b.y, tEnd);
  vec2 tSkip0 = tSkip;   // (the march clears tSkip once across)
#ifdef FULL
  // the planet and its disk, where the ray passes closest to it (1e9: not met, or done; their light is evaluated
  // only there, so that the march carries one number for them)
  float tPl = uPlV.w > 0.0 ? dot(uPlV.xyz - ro, rd) : 1e9;
  if (tPl <= tCut || (tPl > tSkip.x && tPl < tSkip.y)) tPl = 1e9;
#endif
  float tCross = abs(rd.z) > 1e-5 ? -ro.z / rd.z : -1.0;
  // (round 7) the planets as points of light (see uPlG): a warm core of about a pixel and a halo of a few, in the colour
  // of the hot inner part of their own disks, where the ray passes within PG_R CSS px of one (the nearest on the screen)
  float tPGn = 1e9, dPG = PG_R; vec3 cPG = vec3(0.0);
  for (int i = 0; i < MAXP; i++) {
    if (uPlG[i].w <= 0.0) continue;
    vec3 v = uPlG[i].xyz - ro;
    float z = dot(v, uBasis[2]);
    if (z <= 0.0) continue;
    vec2 pp = (vec2(dot(v, uBasis[0]) / (z * uTanHalf * aspect), dot(v, uBasis[1]) / (z * uTanHalf)) * 0.5 + 0.5) * uRes;
    float d = length(gFc - pp) / uPx;
    if (d > dPG) continue;
    dPG = d; cPG = (PG_A * exp(-d * d / 1.4) + PG_H * exp(-d / 2.6)) * uPlG[i].w * (uLook == 0 ? MAT_PLANET : tcolor(1200.0)); tPGn = max(dot(v, rd), 0.0);
  }
  if (faceOpaque) tPGn = 1e9;
  // (round 8) the jet's two lobes, each laid in where the ray passes the axis on its side (round 10a: their places here,
  // their light where it is laid in, see jetLobe)
  vec2 jU = vec2(0.0, 1e9), jL = jU;
  float jj = fract(52.9829189 * fract(0.06711056 * gFc.x + 0.00583715 * gFc.y) + uJit.z);
  if (uJet > 0.0 && !faceOpaque) { jU = jetLobe(ro, rd, 1.0, jj, false); jL = jetLobe(ro, rd, -1.0, jj, false); }
  bool inside = b.y > b.x && !faceOpaque;
  bool cyl = b0.y > b0.x && !faceOpaque;   // (the cylinder met: its stretches in the part cut away hold the wind, cutWind)
  float jitter = fract(52.9829189 * fract(0.06711056 * gFc.x + 0.00583715 * gFc.y) + uJit.z);   // interleaved gradient noise: finer grain than a hash
#ifdef FULL
  if (uLook == 4) {
    // the CO picture over a dark sky, as dark as the other looks' (no stars: a map of the line)
    vec3 bgD = mix(vec3(0.035, 0.040, 0.062), vec3(0.047, 0.056, 0.096), smoothstep(-1.0, 1.0, uv0.y));
    // (round 8: in the cylinder of before, RB_OBS x ZB_OBS, which holds its emission; the march over the larger one of the
    // wind would cost the heaviest look more for nothing)
    vec2 bc = boundsCylRZ(ro, rd, RB_OBS, ZB_OBS);
    bool hit = bc.y > bc.x && !faceOpaque;
    vec4 q = vec4(0.0, 0.0, 0.0, 1.0);
    coNIt = 0.0; coNGas = 0.0; coNGrp = 0.0;
    // (round 10a, dev.6: one group (the channel, the cheaper tier's passes, the window's pass in kicks) through coRun)
    if (uCoMode == 0 || uCoPass == 4 || (uCoPass == 2 && uCoP == 1)) {
      vec4 o;
      if (coRun(ro, rd, bc, tCross, jitter, hit, bgD, o)) return;   // (a kick left the ray going: its state written)
      if (uSplit == 1) { fragColor = o; fragS1 = vec4(0.0); fragS2 = vec4(0.0); fragS3 = vec4(uKickN, float(PH_DONE * 2048), 0.0, 0.0); return; }
      if (uProbe == 1) { fragColor = vec4(coNIt, coNGas, coNGrp, 1.0); return; }
      fragColor = uCoMode == 0 && uProbe == 2 ? vec4(coChanI, 0.0, 0.0, 1.0) : o;   // (diskRayProbe's line values: the channel's intensity)
      return;
    }
    // (round 9: the moments in passes, see coGrid; a pass of sums, written to the float target; or the composite, 3; 0,
    // the warm's draw, nothing)
    if (uCoPass == 2) { vec4 a = coPass(ro, rd, bc, tCross, jitter, hit); fragColor = uProbe == 1 ? vec4(coNIt, coNGas, coNGrp, 1.0) : a; return; }
    else if (uCoPass == 3) q = coMomentsOf(texelFetch(uCoAcc, ivec2(gl_FragCoord.xy), 0));
    fragColor = vec4(max(hit ? coPicture(q) : vec3(0.0), bgD), 1.0);
    // (round 9, diskRayProbe: the counts, or the line's values themselves)
    if (uProbe == 1) fragColor = vec4(coNIt, coNGas, coNGrp, 1.0);
    if (uProbe == 2) fragColor = q;
    return;
  }
#endif
  // the envelope's sphere: the part in front of the cylinder (all of it when the ray misses the cylinder), and behind; not cut
  vec2 be = vec2(1.0, 0.0);
  bool envOn = uEnv > 0.0 && uLook <= 1 && !faceOpaque;
  if (envOn) be = boundsSphere(ro, rd, ENV_R);

  // (round 10a) The ray's state through its stages (PH_), made here, or read from the state where it is drawn in kicks (see
  // SPLIT). cL: the light kept through the automatic exposure (the star's and the magnetosphere's), its luminance (see aeW).
  // budget: the work this invocation may still do (unbounded when the ray is drawn whole)
  vec3 col = vec3(0.0), tr = vec3(1.0), wq = vec3(99.0);
  float cL = 0.0, t = b.x, xPrev = 0.0, wl = 0.0;
  int ph = PH_ENV0, i = 0;
  // the midplane crossing may lie in the unlit outer disk, in front of or behind the marched part (or in the half cut away)
  bool sheetDone = tCross <= tCut || tCross >= tEnd || (tCross > tSkip.x && tCross < tSkip.y) || faceOpaque;
  bool starDone = false;
  float budget = 1e30;
  // (the wind's march in the part cut away, cutWind, while the ray is in it: its t, the place of its last sample, xPrev, wq,
  // wl and step)
  bool inCut = false;
  float tc = 0.0, tsc = 0.0, xc = 0.0, wlc = 0.0; vec3 wqc = vec3(99.0); int jc = 0;
#ifdef FULL
  bool kick = uSplit == 1;
  if (kick) {
    budget = uKickK;
    if (uKick0 == 0) {
      ivec2 sp = ivec2(gl_FragCoord.xy);
      vec4 s0 = texelFetch(uState, ivec3(sp, 0), 0), s1 = texelFetch(uState, ivec3(sp, 1), 0), s2 = texelFetch(uState, ivec3(sp, 2), 0), s3 = texelFetch(uState, ivec3(sp, 3), 0);
      int q = int(s3.y), fl = q % 2048;
      ph = (q / 2048) % 16; jc = q / 32768;   // (never PH_DONE here: see the start of main)
      col = s0.rgb; tr = s1.rgb; gEnvAcc = s2.a; i = int(s3.x); cL = s3.z;
      inCut = (fl & F_CUT) != 0;
      if (inCut) { tc = s0.a; xc = s1.a; wqc = s2.xyz; tsc = s3.w; wlc = (fl & F_CFINE) != 0 ? WIND_FINE + 1.0 : 0.0; }
      else { t = s0.a; xPrev = s1.a; wq = s2.xyz; }
      // (wl only says whether the next step is a fine one, WIND_FINE)
      wl = (fl & F_FINE) != 0 ? WIND_FINE + 1.0 : 0.0;
      sheetDone = (fl & F_SHEET) != 0; starDone = (fl & F_STAR) != 0;
      if ((fl & F_PG) != 0) tPGn = 1e9;
      if ((fl & F_JU) != 0) jU.y = 1e9;
      if ((fl & F_JL) != 0) jL.y = 1e9;
      if ((fl & F_PL) != 0) tPl = 1e9;
      if ((fl & F_SKIP) != 0) tSkip = vec2(1e9);
    }
  }
#endif
  int nIt = 0, nLate = 0;   // (round 9, for diskRayProbe: the march's iterations, and those after the transmission fell under 1e-9)

  // (1) the envelope in front of the cylinder
  if (ph == PH_ENV0) {
    if (!envOn || envMarch(ro, rd, be.x, cyl ? min(b0.x, be.y) : be.y, jitter, i, col, tr, budget)) { ph = PH_CUT0; i = 0; }
  }
  // (2) a crossing of the midplane in front of the cylinder, then the wind and the envelope in the part cut away in front of
  // the part kept (FULL); the crossing in front of the part marched
  if (ph == PH_CUT0) {
#ifdef FULL
    if (!inCut) {
      if (!sheetDone && cyl && tCross < b0.x) { midplaneAt(ro, rd, tCross, col, tr, cL); sheetDone = true; }
      if (cyl && tCut > b0.x && cutWants(b0.x, min(tCut, b0.y))) { cutStart(ro, rd, b0.x, tc, tsc, xc, wqc, wlc, jc); inCut = true; }
    }
    if (inCut && cutWind(ro, rd, min(tCut, b0.y), jitter, tc, tsc, xc, wqc, wlc, jc, col, tr, budget)) inCut = false;
    if (!inCut) {
#endif
      if (!sheetDone && (!inside || tCross < b.x)) { midplaneAt(ro, rd, tCross, col, tr, cL); sheetDone = true; }
      ph = PH_MARCH; i = 0;
      if (inside) { t = b.x; xPrev = lnTauStar(ro + rd * t); wq = vec3(99.0); wl = 0.0; }
#ifdef FULL
    }
#endif
  }
  // (3) the march through the cylinder's part kept
  if (ph == PH_MARCH) {
    bool marchDone = !inside;
    if (inside) {
      bool continuum = false;
#ifdef FULL
      continuum = uLook == 1 || uLook == 2;
#endif
      vec3 p = ro + rd * t;
      // (round 10a) The step that meets the part cut away (tSkip) leaves the march (inCut) for the wind's march there
      // (cutWind), and the march goes on from where the ray leaves it: here, in one place, whether the ray was drawn whole,
      // or its kick ended in the part cut away and this one goes on with it (see SPLIT)
      for (int o = 0; o < 3; o++) {
#ifdef FULL
      if (inCut) {
        if (cutWants(tSkip.x, min(tSkip.y, b.y)) && !cutWind(ro, rd, min(tSkip.y, b.y), jitter, tc, tsc, xc, wqc, wlc, jc, col, tr, budget)) break;   // (the kick's work done there)
        inCut = false;
        t = continuum ? min(tSkip.y, b.y) : tSkip.y; p = ro + rd * t; xPrev = lnTauStar(p);
        wq = vec3(99.0); tSkip = vec2(1e9);
      }
#endif
      for (int k = 0; k < 32768; k++) {
        // (round 10a: the continuum's place from t, here only, so that a ray resumed in a kick takes the same numbers)
        if (continuum) p = ro + rd * t;
        // A transmission-only cutoff loses the entire faint, obscured surface
        // near edge-on. The much smaller optical/IR tolerance is checked against
        // a zero-cutoff march, including the faint inner edge-on image. It changes
        // only the termination accuracy, never the emitted intensity or opacity.
        float transmission = max(tr.r, max(tr.g, tr.b));
        nIt++; if (transmission < 1e-9) nLate++;
        // (round 9) The continuum's march ends where nothing behind can show any more: where the transmission times the
        // brightest light that may lie behind (LIGHT_MAX, in display units past the exposure: about 1250 times white; and the
        // star's own light at this pixel while the ray has yet to reach it) is under CONT_EPS, a tenth of an 8-bit step at
        // the dark end of the stretch (asinh: a step is about 3.4e-4 there). It went on to a transmission of 1e-20 before:
        // in the slowest rays of the visible and mid-infrared looks, 17 to 36 % of the iterations came after 1e-9. (uRayB 0: as
        // before, to compare.)
        if (i >= 32768 || (!continuum && i >= uSteps) || (continuum && i >= uCtMax) || t >= b.y || transmission < (continuum ? (uRayB > 0 ? CONT_EPS / (LIGHT_MAX + (starDone ? 0.0 : maxChannel(starGlow) * uExposure)) : 1e-20) : 0.01)) { marchDone = true; break; }
        // (round 10a: the kick's work done, see SPLIT: the ray on from here in the next)
        if (budget <= 0.0) break;
        int ii = i; i++; budget -= 1.0;
#ifdef FULL
        // (across the part cut away, see above)
        if (continuum && t >= tSkip.x) { cutStart(ro, rd, tSkip.x, tc, tsc, xc, wqc, wlc, jc); inCut = true; break; }
#endif
        float R = length(p.xy);
        // steps follow the scale height in the disk and grow with height above it (only the wind is
        // there); beyond the lit region only the dust sheet matters, and it is crossed analytically
        float Hs = H0 * pow(max(R, 0.2), 1.25), az = abs(p.z);
        bool fine = wl > WIND_FINE;
        float rr = length(p);   // (the longest steps grow with the distance beyond 8 au, as the disk's structure does)
        float ds = clamp(max(0.4 * Hs, (az > 4.5 * Hs ? (fine ? WIND_DS : 0.25) : 0.18) * az), 0.004, fine ? max(WIND_DSMAX, windDs(rr)) : max(0.4, 0.05 * rr));
        // (round 8) from close by (next to the star, at a planet), the wind far behind is a soft background some hundred times
        // farther than the point looked at: there, above the disk, the steps grow up to FAR_K times (the larger region of
        // item 6 made those views the heaviest: the star's place 41 -> 76 ms at scale 0.5 with nothing shown)
        if (az > 4.5 * Hs) ds *= 1.0 + (FAR_K - 1.0) * smoothstep(40.0, 400.0, t / roLen);
        if (ii == 0) ds *= 0.25 + jitter;
        if (continuum) {
          // Stop exactly at the domain exit and at foreground layers. Applying
          // a layer only after the preceding interval preserves depth order.
          float end = b.y;
          if (!sheetDone && tCross > t) end = min(end, tCross);
          if (!starDone && tStar > t) end = min(end, tStar);
#ifdef FULL
          if (tPl > t) end = min(end, tPl);
          end = min(end, tSkip.x);
#endif
          // The geometry-dependent step follows H and height as above. Sixteen
          // substeps resolve the local edge-on residuals against the independent
          // column solver; the old 150/300-step display budget cannot truncate it.
          // (round 9: on a long ray, fewer substeps and then longer steps, see CT_IT; uSubN, 16, or 4 in the cheaper march)
          float sub = uRayB > 0 && float(ii) > uCtIt.x ? max(1.0, uMarch.x * exp2(-(float(ii) - uCtIt.x) / uCtIt.y)) : uMarch.x;
          if (uRayB > 0 && float(ii) > uCtIt.z) ds *= exp2((float(ii) - uCtIt.z) / uCtIt.y);
          ds = min(ds / sub, end - t);
          vec3 light, trans; float x;
          continuumInterval(ro + rd * (t + ds), rd, xPrev, ds, wq, light, trans, x, wl);
          col += tr * light; tr *= trans;
          t = min(t + ds, end); xPrev = x;
          if (!sheetDone && t >= tCross) { midplaneAt(ro, rd, tCross, col, tr, cL); sheetDone = true; }
          if (t >= tPGn) { col += tr * cPG; tPGn = 1e9; }
          if (t >= jU.y) { col += tr * jetLobe(ro, rd, 1.0, jj, true).x * jetCol(); jU.y = 1e9; budget -= KW_JET; }
          if (t >= jL.y) { col += tr * jetLobe(ro, rd, -1.0, jj, true).x * jetCol(); jL.y = 1e9; budget -= KW_JET; }
#ifdef FULL
          if (!starDone && t >= tStar) { starAt(ro, rd, jitter, starGlow, tCut, tSkip0, col, tr, cL); starDone = true; budget -= KW_STAR; }
          if (t >= tPl) { vec4 pl = planetLight(ro, rd, aspect); col += tr * pl.rgb; tr *= exp(-pl.a); tPl = 1e9; budget -= KW_PL; }
#endif
          continue;
        }
        float t1 = t + ds;
#ifdef FULL
        // across the part cut away (see above)
        if (t1 > tSkip.x) { cutStart(ro, rd, tSkip.x, tc, tsc, xc, wqc, wlc, jc); inCut = true; break; }
#endif
        if (!sheetDone && t1 >= tCross) { midplaneAt(ro, rd, tCross, col, tr, cL); sheetDone = true; }
        if (t1 >= tPGn) { col += tr * cPG; tPGn = 1e9; }
        if (t1 >= jU.y) { col += tr * jetLobe(ro, rd, 1.0, jj, true).x * jetCol(); jU.y = 1e9; budget -= KW_JET; }
        if (t1 >= jL.y) { col += tr * jetLobe(ro, rd, -1.0, jj, true).x * jetCol(); jL.y = 1e9; budget -= KW_JET; }
#ifdef FULL
        if (!starDone && t1 >= tStar) { starAt(ro, rd, jitter, starGlow, tCut, tSkip0, col, tr, cL); starDone = true; budget -= KW_STAR; }
#else
        if (!starDone && t1 >= tStar) { vec3 sg = tr * starGlow; col += sg; cL += dot(sg, LUMW); starDone = true; }
#endif
#ifdef FULL
        if (t1 >= tPl) { vec4 pl = planetLight(ro, rd, aspect); col += tr * pl.rgb; tr *= exp(-pl.a); tPl = 1e9; budget -= KW_PL; }
        // (the millimetre look: the volume neither emits nor absorbs there, only the pebble sheet and the star; skip its
        // samples. From origin/main's dc55d44)
        if (uLook == 3) { t = t1; continue; }
#endif
        p = ro + rd * t1;
        vec3 em, ex, sk; float x;
        sampleDisk(p, rd, xPrev, ds, wq, em, ex, sk, x, wl);
        vec3 a = exp(-ex * ds);
        float ak = airK(t1);   // (round 8: the depth's haze, see AIR)
        col += tr * sk * ak;
        col += tr * em * ds * transferWeight(ex * ds) * ak;
        tr *= a;
        xPrev = x; t = t1;
      }
      if (!inCut && i >= 32768) marchDone = true;   // (its last step taken as the loop ended: see cutWind's end)
      if (!inCut) break;   // (the march ended, or the kick's work is done)
      }
    }
    if (marchDone) ph = PH_BACK;
  }
  // (4) what the march left: the midplane's crossing, the planets' points of light and the jet's lobes behind its end, and
  // the star where the march did not reach it (or none was made)
  if (ph == PH_BACK && budget > 0.0) {
    if (!sheetDone) { midplaneAt(ro, rd, tCross, col, tr, cL); sheetDone = true; }
    if (tPGn < 1e8) { col += tr * cPG; tPGn = 1e9; }   // (a march that ended early, or none)
    if (jU.y < 1e8) { col += tr * jetLobe(ro, rd, 1.0, jj, true).x * jetCol(); jU.y = 1e9; budget -= KW_JET; }
    if (jL.y < 1e8) { col += tr * jetLobe(ro, rd, -1.0, jj, true).x * jetCol(); jL.y = 1e9; budget -= KW_JET; }
#ifdef FULL
    if (!starDone && tCut < 1e8) { starAt(ro, rd, jitter, starGlow, tCut, tSkip0, col, tr, cL); budget -= KW_STAR; }
    starDone = true;
    // (the part cut away behind the part kept)
    if (cyl && tEnd < b0.y && cutWants(max(tEnd, b0.x), b0.y)) { cutStart(ro, rd, max(tEnd, b0.x), tc, tsc, xc, wqc, wlc, jc); inCut = true; }
#else
    if (!starDone && tCut < 1e8) { vec3 sg = tr * starGlow; col += sg; cL += dot(sg, LUMW); }
    starDone = true;
#endif
    ph = PH_CUT1;
  }
  // (5) the wind in the part cut away behind the part kept (FULL)
  if (ph == PH_CUT1) {
#ifdef FULL
    if (inCut && cutWind(ro, rd, b0.y, jitter, tc, tsc, xc, wqc, wlc, jc, col, tr, budget)) inCut = false;
#endif
    if (!inCut) { ph = PH_ENV1; i = 0; }
  }
  // (6) the envelope behind the cylinder
  if (ph == PH_ENV1) {
    if (!(cyl && be.y > b0.y) || envMarch(ro, rd, b0.y, be.y, jitter, i, col, tr, budget)) ph = PH_FINAL;
  }
  // (7) the display value: the sky behind, the exposure, the stretch
  if (ph == PH_FINAL && budget > 0.0) {
    // background: deep gradient with sparse faint stars (kept at the pixels' centres, so they stay crisp in a refined still)
    // (round 8: or none, or the sky of a star-forming region, uBg; that in the model and visible looks, the stars alone in
    // the others)
    vec3 sky = mix(vec3(0.0020, 0.0026, 0.0050), vec3(0.0040, 0.0056, 0.0130), smoothstep(-1.0, 1.0, uv0.y));
    vec3 dSky = normalize(uBasis[2] + uTanHalf * (uv0.x * aspect * uBasis[0] + uv0.y * uBasis[1])), bg = vec3(0.0);
    if (uBg == 1 || (uBg == 2 && uLook > 1)) bg = stars(dSky, pixA);
    else if (uBg == 2) {
      vec4 sk = texture(uSky, vec2(atan(dSky.y, dSky.x) / (2.0 * PI) + 0.5, asin(clamp(dSky.z, -1.0, 1.0)) / PI + 0.5));
      // (round 9) a rich field behind the cloud, denser toward the Milky Way's band: faint ones in small cells, brighter ones
      // in larger; dimmed and reddened by the cloud's transmission (most hidden behind its cores)
      vec3 ext = pow(vec3(sk.a), vec3(0.75, 1.0, 1.32));
      float mb = dot(dSky, normalize(vec3(${BG.MW.join(', ')}))), dens = 0.5 + 1.6 * exp(-0.5 * mb * mb / 0.03);
      bg = sk.rgb + starsIn(dSky, pixA, 6.0, 0.12 * dens, 0.035, 0.0025, 0.18, 0.0, ext) + starsIn(dSky, pixA, 19.0, 0.06 * dens, 0.16, 0.006, 0.18, 5.0, ext);
      sky *= 0.6 * (0.3 + 0.7 * sk.a);   // (the faint glow of the sky behind, dimmed by the cloud: its cores darker)
${BG.LAMPS.map(([x, y, z, , k]) => `      { float t = acos(clamp(dot(dSky, normalize(vec3(${x}, ${y}, ${z}))), -1.0, 1.0)) / (0.6 * uPx * pixA); bg += vec3(0.90, 0.93, 1.0) * ${(0.06 * k).toFixed(3)} * (exp(-0.5 * t * t) + 0.1 * exp(-t / 3.0)); }`).join('\n')}
    }
    // (the share of the pixel's light that the automatic exposure measures: not the star's and the magnetosphere's, kept
    // as they are (their share reckoned without the compensation, so that it does not grow as the exposure falls), nor a
    // cut face, a picture of a quantity laid over in display values)
    float lC = cL / uStarK, lT = dot(col, LUMW) - cL + lC;
    float aeW = (1.0 - face.a) * (1.0 - clamp(lC / max(lT, 1e-9), 0.0, 1.0));
    col = col * uExposure + tr * bg + sky;
    // asinh stretch of the luminance, as for astronomical images of high dynamic range; hue is kept and
    // channels that run past white roll off toward it
    float L = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
    col *= pow(asinh(L / 0.012) / 7.2, 2.2) / L;
    float m = max(col.r, max(col.g, col.b));
    if (m > 1.0) col = mix(col / m, vec3(1.0), 1.0 - 1.0 / m);
    col = pow(col, vec3(1.0 / 2.2));   // (the cut face, a picture of a quantity, is laid over in display values by SHOW_FS)
    fragColor = vec4(col, aeW);   // (alpha: see aeW)
    ph = PH_DONE;
  }
#ifdef FULL
  // (round 10a: a kick's state written, see above; a ray done keeps its display value in layer 0)
  if (kick) {
    if (ph == PH_DONE) { fragS1 = vec4(0.0); fragS2 = vec4(0.0); fragS3 = vec4(uKickN, float(PH_DONE * 2048), 0.0, 0.0); }
    else {
      int fl = (sheetDone ? F_SHEET : 0) | (starDone ? F_STAR : 0) | (tPGn > 1e8 ? F_PG : 0) | (jU.y > 1e8 ? F_JU : 0) | (jL.y > 1e8 ? F_JL : 0)
             | (tPl > 1e8 ? F_PL : 0) | (tSkip.x > 1e8 ? F_SKIP : 0) | (wl > WIND_FINE ? F_FINE : 0) | (wlc > WIND_FINE ? F_CFINE : 0) | (inCut ? F_CUT : 0);
      fragColor = vec4(col, inCut ? tc : t);
      fragS1 = vec4(tr, inCut ? xc : xPrev);
      fragS2 = vec4(inCut ? wqc : wq, gEnvAcc);
      fragS3 = vec4(float(i), float((jc * 16 + ph) * 2048 + fl), cL, tsc);
    }
    return;
  }
#endif
  if (uProbe > 0) fragColor = vec4(float(nIt), float(nLate), log(max(max(tr.r, max(tr.g, tr.b)), 1e-30)) / 2.302585, 1.0);   // (round 9: see diskRayProbe)
#ifdef SAFE_MATH
  // (round 10a, the page's ?math=safe, for a comparison on the phone: never true, but a use of isnan makes ANGLE's Metal
  // backend compile this program with safe math instead of fast math, under which NaN and infinity are undefined)
  if (isnan(uExposure)) fragColor = vec4(0.0);
#endif
}`;


  // The automatic exposure's measurement (see AE in init): the frame in AE_W x AE_H cells, each from 4 x 4 samples of
  // its display values: the luminance and the share of it above 0.92 (blown out), both weighted by the volume's share of
  // the pixel (the frame's alpha: a cut face is a picture of a quantity and not exposed), and that weight.
  const AE_W = 32, AE_H = 18;
  const AE_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uAcc;
uniform vec2 uSrc;
void main(){
  vec2 cs = uSrc / vec2(${AE_W}.0, ${AE_H}.0), c0 = floor(gl_FragCoord.xy) * cs;
  float s = 0.0, b = 0.0, w = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec4 c = texelFetch(uAcc, ivec2(c0 + (vec2(float(i), float(j)) + 0.5) * cs * 0.25), 0);
    float L = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), a = clamp(c.a, 0.0, 1.0);
    s += a * L; b += a * step(0.92, L); w += a;
  }
  fragColor = vec4(s, b, w, 16.0) / 16.0;
}`;

  // (round 10a) The picture's health, for the page's flight recorder: the volume's picture in accT (its rW x rH part, uSrc)
  // in HEALTH_W x HEALTH_H cells, every texel of each looked at: the share of them not finite (NaN or infinite: a bug, not a
  // cost), the share negative (a display value below zero, which the stretch's power turns into NaN), and the largest
  // value (display values: 1 is white; half floats end at 65504). Written in 8 bits and read back without waiting, at the
  // page's request only (diskHealth), never in every frame. "Not finite" is a comparison that NaN and infinity both fail,
  // so that a compiler's fast math cannot assume it away as it may isnan.
  const HEALTH_W = 32, HEALTH_H = 18;
  const HEALTH_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uAcc;
uniform vec2 uSrc;
void main(){
  vec2 cs = uSrc / vec2(${HEALTH_W}.0, ${HEALTH_H}.0);
  ivec2 a = ivec2(floor(floor(gl_FragCoord.xy) * cs)), b = max(ivec2(floor((floor(gl_FragCoord.xy) + 1.0) * cs)), a + 1);
  float bad = 0.0, neg = 0.0, mx = 0.0, n = 0.0;
  bvec3 chan = bvec3(false);   // (round 10a: which channels were not finite: one channel alone shows coloured, G alone magenta)
  for (int y = a.y; y < b.y; y++) for (int x = a.x; x < b.x; x++) {
    vec4 c = texelFetch(uAcc, ivec2(x, y), 0);
    bvec3 f = bvec3(abs(c.r) < 1e30, abs(c.g) < 1e30, abs(c.b) < 1e30);
    n += 1.0;
    if (!(f.x && f.y && f.z && abs(c.a) < 1e30)) { bad += 1.0; chan = bvec3(chan.x || !f.x, chan.y || !f.y, chan.z || !f.z); continue; }
    if (min(c.r, min(c.g, c.b)) < -1e-3) neg += 1.0;
    mx = max(mx, max(c.r, max(c.g, c.b)));
  }
  // (a cell with any bad texel shows at least one step: a single NaN pixel among a thousand is not rounded away; alpha: the
  // channels not finite, 1 red, 2 green, 4 blue, in steps of 32)
  float mask = (chan.x ? 1.0 : 0.0) + (chan.y ? 2.0 : 0.0) + (chan.z ? 4.0 : 0.0);
  fragColor = vec4(bad > 0.0 ? max(bad / n, 1.0 / 255.0) : 0.0, neg > 0.0 ? max(neg / n, 1.0 / 255.0) : 0.0, min(mx, 4.0) / 4.0, mask * 32.0 / 255.0);
}`;

  // The picture is drawn into a float target and shown by this pass, with a dither against banding: a still picture is
  // refined there (see the accumulation in draw).
  // The display: the volume (accT, at the render scale) upsampled to the screen's pixels (bilinear), and the cut face
  // (faceT, at the screen's resolution, premultiplied) laid over it in display values; dithered.
  // (Disk Lab v2) A frame that is not yet averaged with others (the clock running, the view moving) carries the march's
  // jitter as it is: interleaved gradient noise, the same every frame, a fine diagonal lattice that the bilinear
  // upsampling of a low render scale shows as dotted, jagged bands where the volume changes within a step (the inner
  // disk's turbulent bands next to the star). Such a frame is shown through a small tent filter of the render's pixels
  // (four bilinear taps half a texel off on the diagonals: weights 1-2-1 by 1-2-1), which removes the lattice (its power
  // lies near the render's Nyquist frequency) and softens the picture by under one render pixel; the filter fades out
  // over the first frames of a still picture's averaging (uSoft), which removes the jitter itself.
  // (Round 8, item 29) The finish, in the display's values, by the page's quality (see opt.fx): the
  // glow of the bright parts (the star, the hot inner rim, the planets' points: what lies above BLOOM.T), taken from the
  // volume's picture at a quarter of its size and blurred over about BLOOM.R of the picture's height, added at BLOOM.K;
  // and a tone curve that deepens the dark and middle tones, c - TONE c (1 - c)^2 (a third darker at 0.3, the bright parts
  // kept), so that the volume's haze does not flatten the picture.
  const BLOOM = { T: 0.85, K: 0.25, R: 0.015 }, TONE = 0.5;
  const BLOOM_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform int uPass;        // 0: the bright parts of the volume (uSrc: accT); 1, 2: the blur along x, along y
uniform vec4 uSrcPart;    // (pass 0: the volume's part of accT, as for SHOW_FS; xy its size, zw its last texel centres)
uniform vec2 uDst;        // the bloom's size in texels (the part used)
uniform vec2 uSrcTexel;   // a texel of uSrc
uniform float uStep;      // (passes 1, 2: the taps' spacing, texels)
void main(){
  if (uPass == 0) {
    vec2 uv = gl_FragCoord.xy / uDst * uSrcPart.xy, h = uSrcTexel;
    vec3 c = vec3(0.0);
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) c += texture(uSrc, min(uv + (vec2(float(i), float(j)) - 0.5) * 2.0 * h, uSrcPart.zw)).rgb;
    c *= 0.25;
    float L = max(c.r, max(c.g, c.b));
    fragColor = vec4(c * max(L - ${BLOOM.T}, 0.0) / max(L, 1e-4) / ${(1 - BLOOM.T).toFixed(3)}, 1.0);
    return;
  }
  vec2 d = (uPass == 1 ? vec2(uSrcTexel.x, 0.0) : vec2(0.0, uSrcTexel.y)) * uStep, uv = gl_FragCoord.xy * uSrcTexel;
  vec3 c = texture(uSrc, uv).rgb * 0.2270;
  c += (texture(uSrc, uv + d).rgb + texture(uSrc, uv - d).rgb) * 0.1946;
  c += (texture(uSrc, uv + 2.0 * d).rgb + texture(uSrc, uv - 2.0 * d).rgb) * 0.1216;
  c += (texture(uSrc, uv + 3.0 * d).rgb + texture(uSrc, uv - 3.0 * d).rgb) * 0.0541;
  c += (texture(uSrc, uv + 4.0 * d).rgb + texture(uSrc, uv - 4.0 * d).rgb) * 0.0162;
  fragColor = vec4(c, 1.0);
}`;
  const SHOW_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uAcc;
uniform sampler2D uFace;
uniform sampler2D uBloom;   // (round 8: the bright parts' glow, see BLOOM)
uniform vec3 uBloomP;       // its part of the bloom target (xy) and its strength (z)
uniform float uTone;        // the tone curve's share (see TONE)
uniform vec2 uDev;
uniform int uFaceOn;
uniform vec4 uAccPart;   // (the volume's part of accT, as fractions of it: its size, and the last texel centres)
uniform vec2 uTexel;     // (a texel of accT)
uniform float uSoft;     // the tent filter's weight (see above)
${NOISE_GLSL}
void main(){
  vec2 uv = min(gl_FragCoord.xy / uDev * uAccPart.xy, uAccPart.zw);
  vec3 c = texture(uAcc, uv).rgb;
  if (uSoft > 0.0) {
    vec2 h = 0.5 * uTexel, lo = h, hi = uAccPart.zw;
    vec3 t = texture(uAcc, clamp(uv + vec2(-h.x, -h.y), lo, hi)).rgb + texture(uAcc, clamp(uv + vec2(h.x, -h.y), lo, hi)).rgb
           + texture(uAcc, clamp(uv + vec2(-h.x, h.y), lo, hi)).rgb + texture(uAcc, clamp(uv + vec2(h.x, h.y), lo, hi)).rgb;
    c = mix(c, 0.25 * t, uSoft);
  }
  if (uBloomP.z > 0.0) c += uBloomP.z * texture(uBloom, gl_FragCoord.xy / uDev * uBloomP.xy).rgb;
  if (uTone > 0.0) { vec3 k = clamp(c, 0.0, 1.0); c -= uTone * k * (1.0 - k) * (1.0 - k); }
  if (uFaceOn != 0) { vec4 f = texelFetch(uFace, ivec2(gl_FragCoord.xy), 0); c = c * (1.0 - f.a) + f.rgb; }
  fragColor = vec4(c + (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0, 1.0);
}`;

  // The field model again in JS, for the field lines and wind parcels drawn as vector strokes in the SVG
  // overlay (kept in step with FIELD_GLSL above).
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const cutOut = (R) => Math.pow(R / MODEL.R_OUT, MODEL.P_OUT);
  const zBase = (Rf) => MODEL.H0 * Math.pow(Rf, 1.25) * Math.sqrt(2 * Math.max(MODEL.LNTAU1 - 1.25 * Math.log(Rf) - cutOut(Rf), 1));
  const SigmaJS = (R) => Math.exp(-Math.log(R) - cutOut(R)) * ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, R);
  // (round 8) the pebbles' outer edge relative to the gas's (see MODEL.R_PEB)
  const pebEdge = (R) => Math.exp(cutOut(R) - Math.pow(R / MODEL.R_PEB, MODEL.P_OUT));
  const Hof = (R) => MODEL.H0 * Math.pow(R, 1.25);
  // the dead zone's top in units of H (as zKinkH in the GLSL; 0 where there is none) and where the gas is turbulent
  const mriAmpJS = (R) => 1 - ss(0.75 * NONIDEAL.R_TI, 1.15 * NONIDEAL.R_TI, R);
  const zKinkHJS = (R) => Math.sqrt(2 * Math.max(NONIDEAL.Q * Math.log(NONIDEAL.R_DZ / R) - 0.5 * cutOut(R) - NONIDEAL.TI * mriAmpJS(R), 0));
  const accAmpJS = (R) => 1 - mriAmpJS(R);   // where there is an accretion layer (as accAmp in the GLSL; round 8)
  const zAccHJS = (R) => { const zk = zKinkHJS(R); return zk + ACC.OFF * Math.min(zk, 1); };   // its centre (units of H; as zAccH)
  const zAccLowJS = (R, f) => { const zb = zBase(R) / Hof(R); return zAccHJS(R) + (Math.max(zb - 0.5 * Math.min(NONIDEAL.BEND, 0.5 * zb), zAccHJS(R)) - zAccHJS(R)) * f * (1 - ss(NONIDEAL.R_OT[0], NONIDEAL.R_OT[1], R)); };
  // (round 7) the temperature, as tempAt in the GLSL (see THERMO), at R, z/H and ln tau* x, for the star's luminosity lum
  // relative to its own; the midplane's; and the snow line, where the midplane is at TICE (bisection: it falls with R)
  const erfJS = (x) => { const x2 = x * x, a = 0.147; return Math.sign(x) * Math.sqrt(1 - Math.exp(-x2 * (1.2732395 + a * x2) / (1 + a * x2))); };
  const betaIrrJS = (R) => { const c = cutOut(R), a = Math.max(MODEL.LNTAU1 - 1.25 * Math.log(R) - c, 1); return Math.max(MODEL.H0 * Math.pow(R, 0.25) * Math.sqrt(2 * a) * (0.25 - (0.625 + 0.5 * MODEL.P_OUT * c) / a), 0) + 0.004 / R; };
  const tInt4JS = (R, zh, lum = 1) => {
    const m = mriAmpJS(R), az = Math.abs(zh), u = 1 - erfJS(az * Math.SQRT1_2), za = zAccHJS(R), ua = Math.max(1 - erfJS(za * Math.SQRT1_2), 1e-6);
    const tm4 = THERMO.KM / (R * R * R) * (az < za ? 1 : (THERMO.TAU_HEAT * u / ua + 0.57735) / (THERMO.TAU_HEAT + 0.57735));
    const tv = THERMO.KV * Math.pow(R, -0.9), tv4 = tv * tv * tv * tv * (2 * u - u * u + 0.003) / 1.003;
    return THERMO.KI * lum * betaIrrJS(R) / (R * R) + (1 - m) * tm4 + m * tv4 + Math.pow(THERMO.T_FLOOR, 4);
  };
  const subCapJS = (T) => T * Math.pow(1 + Math.pow(T / THERMO.T_SUB, 8), -0.125);
  const tempJS = (R, zh, x, lum = 1) => { const t4 = tInt4JS(R, zh, lum); return subCapJS(Math.pow(t4 * Math.pow(t4, 0.25) + THERMO.KDS5 * lum / (R * R) * Math.exp(-Math.exp(Math.min(x, 20))), 0.2)); };
  const tMidJS = (R, lum = 1) => subCapJS(Math.pow(tInt4JS(R, 0, lum), 0.25));
  const snowR = (lum = 1) => { let lo = 0.05, hi = 30; for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (tMidJS(m, lum) > MODEL.TICE) lo = m; else hi = m; } return Math.sqrt(lo * hi); };
  // (Disk Lab v2, round 6) A planet's gap: the profile of Kanagawa et al. (2017, eqs. 10-14), from the fits to
  // two-dimensional simulations of Kanagawa et al. (2015, 2016): with K' = q^2 h^-3 / alpha and K = K' / h^2 (h = H/R at the
  // planet), Sigma / Sigma_0 is Sigma_min / Sigma_0 = 1 / (1 + 0.04 K) within dR1 = (Sigma_min / 4 Sigma_0 + 0.08) K'^1/4 a
  // of the orbit, climbs linearly as 4 K'^-1/4 |R - a| / a - 0.32 to 1 at dR2 = 0.33 K'^1/4 a, and is 1 beyond. Its full
  // width at half depth is then 0.41 K'^1/4 a, Kanagawa et al. (2016). GAP_ALPHA is the viscosity it assumes: 1e-3, the
  // upper end of what the outer disk's weak turbulence gives (1e-4 to 1e-3) and the usual value of the literature; the dead
  // zone where the planets mostly orbit is laminar, and a lower alpha (as in the wind-driven disks of Aoyama & Bai 2023)
  // would make the gap wider and deeper still (1e-4: 0.8 to 5.2 au for a Jupiter at 3 au). Before round 6 the gap was a
  // Gaussian of width (sigma) 1.8 Hill radii, half-depth width 0.2 a, three to five times narrower than this at any alpha
  // of 1e-4 to 1e-2, and 0.98 deep close up, 0.3 afar (now the depth is the profile's, from every distance).
  // gapK(a): { depth (1 - Sigma_min/Sigma_0), smin, k4 (K'^1/4), dR1, dR2 } for a Jupiter at a; gapShape: the share of
  // the depth at R (1 in the floor, 0 outside the walls); gapLnJS: ln of the factor on Sigma at depth d (as gapLn in
  // PLANET_GLSL, through the table).
  let GAP_ALPHA = 1e-3;   // (round 8: a let, so that box.diskGapAlpha can show other values for the owner to choose)
  const gapKMemo = new Map();
  // (round 8: for a planet of mass ratio q, PLANET.Q by default)
  const gapK = (a, q = PLANET.Q) => {
    const mk = a + ':' + q;
    let k = gapKMemo.get(mk);
    if (k) return k;
    const h = MODEL.H0 * Math.pow(a, 0.25), Kp = q * q / (h * h * h * GAP_ALPHA), k4 = Math.pow(Kp, 0.25), smin = 1 / (1 + 0.04 * Kp / (h * h));
    k = { h, Kp, k4, smin, depth: 1 - smin, dR1: (smin / 4 + 0.08) * k4 * a, dR2: 0.33 * k4 * a };
    if (gapKMemo.size > 400) gapKMemo.clear();
    gapKMemo.set(mk, k);
    return k;
  };
  const gapShape = (R, a, q = PLANET.Q) => {
    const k = gapK(a, q), y = Math.abs(R - a);
    return y >= k.dR2 ? 0 : y <= k.dR1 ? 1 : (1.32 - 4 * y / (a * k.k4)) / (1 - k.smin);
  };
  const gapLnJS = (R, d, a = PLANET.A, q = PLANET.Q) => (d > 0 ? Math.log(1 - d * gapShape(R, a, q)) : 0);
  // The pebbles' response to a gap of depth d: the fraction filtered out of it (1.08 d, at most 0.99), in the gas's gap a
  // tenth wider, and the pressure maximum outside it (P ∝ Σ R^-7/4 at the midplane, with the edge cutoff and the other
  // planets' gaps, others: [{ a, d }]), where they collect, a ring half a scale height wide. With this profile the maximum
  // lies at the outer wall's top, dR2 beyond the orbit (5.0 au for a Jupiter at 3 au); there is none where a neighbour's
  // gap joins this one (a common gap: the pebbles are not held between them). The trap's strength grows with the depth from
  // 0.33 to 0.9. Remembered per depth (to 1e-3), radius and neighbours.
  const trapMemo = new Map();
  function trapOf(d, a = PLANET.A, others = [], q = PLANET.Q) {
    const key = Math.round(d * 1000) + ':' + a.toFixed(3) + ':' + q.toPrecision(3) + others.map((o) => ':' + o.a.toFixed(3) + '/' + Math.round(o.d * 1000) + '/' + o.q.toPrecision(3)).join('');
    let t = trapMemo.get(key);
    if (t) return t;
    const k = gapK(a, q), dR = 1e-3 * a / PLANET.A;
    let prev = null, rising = false, Rt = a + k.dR2, found = false;
    for (let R = a + 0.5 * k.dR1; R < a + 1.6 * k.dR2 && !found; R += dR) {
      const v = -2.75 * Math.log(R) - cutOut(R) + gapLnJS(R, d, a, q) + others.reduce((sum, o) => sum + gapLnJS(R, o.d, o.a, o.q), 0);
      if (prev !== null) { if (v > prev) rising = true; else if (rising) { Rt = R - dR; found = true; } }
      prev = v;
    }
    // (round 8: and only above the pebble isolation mass, see MASS)
    t = { R: Rt, filt: Math.min(0.99, 1.08 * d), s: found ? ss(0.33, 0.9, d) * ss(0.7, 1.3, q / isoQ(a)) : 0, w: 0.5 * Hof(Rt) };
    if (trapMemo.size > 400) trapMemo.clear();
    trapMemo.set(key, t);
    return t;
  }
  // the pebbles relative to the smooth disk (as in sheet), with the planet's trap t
  const pebbleJS = (R, d, a = PLANET.A, t = trapOf(d, a), q = PLANET.Q) => {
    if (d <= 0 || Math.abs(R - a) > 1.8 * gapK(a, q).dR2) return 1;
    const xt = (R - t.R) / t.w;
    return (1 - t.filt * gapShape(a + (R - a) / 1.1, a, q)) * (1 + PEB_RING * t.s * Math.exp(-xt * xt));
  };
  // Starlight absorbed per unit area with the gap, relative to the smooth disk. Rays leave the star at angles th = 0.05
  // (round 7; 0.09 before, above the surface's angle at 0.05 to 0.2 au, 0.07 to 0.09, for planets close to the star)
  // to 0.26 above the midplane (every 0.002), start at 0.2 a (inside the gap's reach) with the optical depth of the local
  // formula, and cross the gas outward in steps of 0.01 a / 3, depositing e^-tau dtau on the way. The gas is that of the
  // volume (Σ with the gap, Gaussian in height); its opacity k makes dtau/dR agree with the local formula at the surface
  // at 2 au. The ratio of the deposits with and without the gap, on 128 radii (GL_R0 + j GL_DR) a / A_REF, from 0.3 a to
  // 3.2 a (it eases to 1 toward the end of the table). Tabulated at the depths GL_LEVELS, each when first needed (under
  // 2 ms), and interpolated in g = -ln(1 - depth) between neighbours. (Round 6: traced for each planet's radius, as the
  // gap's width relative to a changes with h, as a^-3/16; before, the table made for 3 au was stretched with a.)
  // gapLight(a)(d, out) fills out.
  const GL_LEVELS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 0.92, 0.96, 0.98, 0.995];
  const gapLightMemo = new Map();
  const gapLight = (aIn, q = PLANET.Q) => {
    const a = +aIn.toPrecision(3), mk = a + ':' + q.toPrecision(3);
    let fill = gapLightMemo.get(mk);
    if (fill) return fill;
    const sc = a / PLANET.A, R0 = 0.6 * sc, dR = 0.01 * sc, n = Math.round((9.6 - 0.6) / 0.01) + 1;
    const Rg = new Float64Array(n), lnS = new Float64Array(n), ih2 = new Float64Array(n);
    for (let i = 0; i < n; i++) { const R = R0 + i * dR; Rg[i] = R; lnS[i] = -Math.log(R) - cutOut(R) - Math.log(Hof(R)); ih2[i] = 0.5 / (Hof(R) * Hof(R)); }
    const R2 = 2, H2 = Hof(R2), a2 = MODEL.LNTAU1 - 1.25 * Math.log(R2) - cutOut(R2), th2 = H2 * Math.sqrt(2 * a2) / R2;
    const k = (-1.25 / R2 - MODEL.P_OUT * cutOut(R2) / R2 + 0.25 * th2 * th2 * R2 / (H2 * H2)) / Math.exp(-Math.log(R2) - cutOut(R2) - Math.log(H2) - a2);
    const a0 = MODEL.LNTAU1 - 1.25 * Math.log(R0) - cutOut(R0), H0s = Hof(R0);
    const deposit = (d) => {
      const lg = Rg.map((R) => gapLnJS(R, d, a, q)), out = new Float64Array(n);
      for (let th = 0.05; th < 0.2605; th += 0.002) {
        let tau = Math.exp(a0 - 0.5 * th * R0 * th * R0 / (H0s * H0s)), rPrev = 0;
        for (let i = 0; i < n; i++) {
          const R = Rg[i], r = k * Math.exp(lnS[i] + lg[i] - th * th * R * R * ih2[i]);
          if (i) tau += 0.5 * (r + rPrev) * dR;
          out[i] += Math.exp(-tau) * r; rPrev = r;
        }
      }
      return out;
    };
    let base = null;
    const tables = [new Float32Array(128).fill(1)], gOf = (d) => -Math.log(1 - d);
    const table = (l) => {
      if (tables[l]) return tables[l];
      base = base || deposit(0);
      const dep = deposit(GL_LEVELS[l]);
      return (tables[l] = Float32Array.from({ length: 128 }, (_, j) => {
        const x = GL_R0 + j * GL_DR, f = (x * sc - R0) / dR, i = Math.min(n - 2, Math.max(0, Math.floor(f))), u = Math.min(1, Math.max(0, f - i));
        const q = (dep[i] + (dep[i + 1] - dep[i]) * u) / (base[i] + (base[i + 1] - base[i]) * u);
        return 1 + (q - 1) * (1 - ss(8.6, 9.4, x));
      }));
    };
    fill = (d, out) => {
      const g = gOf(Math.min(Math.max(d, 0), GL_LEVELS[GL_LEVELS.length - 1]));
      let l = 0;
      while (l < GL_LEVELS.length - 2 && gOf(GL_LEVELS[l + 1]) <= g) l++;
      const g0 = gOf(GL_LEVELS[l]), u = Math.min(1, (g - g0) / (gOf(GL_LEVELS[l + 1]) - g0)), ta = table(l), tb = table(l + 1);
      for (let j = 0; j < 128; j++) out[j] = ta[j] + (tb[j] - ta[j]) * u;
    };
    // makes the next table not yet made (false when all are): for idle time
    fill.prefetch = () => { const l = GL_LEVELS.findIndex((_, i) => !tables[i]); if (l < 0) return false; table(l); return true; };
    if (gapLightMemo.size > 24) gapLightMemo.clear();
    gapLightMemo.set(mk, fill);
    return fill;
  };
  const NT = BP.XI.length;
  if (NT !== 64) throw new Error('the wind table must have 64 rows');
  const tabF = (arr, f) => { f = Math.min(Math.max(f, 0), NT - 1.001); const i = Math.floor(f); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); };
  const tabS = (chi) => Math.log(1 + chi / BP.C0) * ((NT - 1) / BP.SMAX);
  const chiOfS = (sv) => BP.C0 * (Math.exp(sv * BP.SMAX / (NT - 1)) - 1);
  // the line's bend inside the disk (as bendQ in the GLSL; s the asymmetry's signed share for the side), its radius at
  // the wind's base, and the heights to draw it at through the disk (the midplane, the dead zone's top, across the
  // bend, and up to the base)
  function bendQ(Rf, h, zb, s = 0) {
    const H = Hof(Rf), d = Math.min(NONIDEAL.BEND * H, 0.5 * zb), hi = Math.min(h, zb);
    let zk = Math.min(zKinkHJS(Rf) * H, zb - d);
    if (s < 0) zk += (zb - d - zk) * Math.min(-s / ASYM_F_JS, 1) * (1 - ss(NONIDEAL.R_OT[0], NONIDEAL.R_OT[1], Rf));   // (round 8: the lower side's bend rises with the asymmetry, where the Hall effect rules)
    const q = hi <= zk ? 0 : hi < zk + d ? 0.5 * (hi - zk) * (hi - zk) / d : hi - zk - 0.5 * d;
    return q + s * (hi - q);
  }
  // (round 8) the solution of the line with foot Rf: the two tables around its lever arm mixed (see LAM), remembered per foot
  const bpMemo = new Map();
  function bpOf(Rf) {
    const key = Rf;   // (the lines' feet are a few fixed numbers; the cut's contours ask for more, cleared past 2000)
    let T = bpMemo.get(key);
    if (T) return T;
    const l = lamOf(Rf);
    let j = 0;
    for (let k = 1; k < NBP - 1; k++) if (l >= BPL[k].LAM) j = k;
    const a = BPL[j], b = BPL[j + 1], u = Math.min(1, Math.max(0, (l - a.LAM) / (b.LAM - a.LAM))), mx = (x, y) => x + (y - x) * u;
    T = { LAM: l, A0: mx(a.A0, b.A0), B0: mx(a.B0, b.B0) };
    for (const k of ['XI', 'PHI', 'TAU', 'LNEK', 'F', 'G', 'XIP']) T[k] = a[k].map((v, i) => mx(v, b[k][i]));
    if (bpMemo.size > 2000) bpMemo.clear();
    bpMemo.set(key, T);
    return T;
  }
  const r0Of = (Rf, s = 0) => { const zb = zBase(Rf); return Rf + bpOf(Rf).A0 * bendQ(Rf, zb, zb, s); };
  // (the lower side's lowest point of the bend, with the asymmetry's share s < 0: round 8)
  function diskHeights(Rf, s = 0) {
    const zb = zBase(Rf), H = Hof(Rf), d = Math.min(NONIDEAL.BEND * H, 0.5 * zb);
    let zk = Math.min(zKinkHJS(Rf) * H, zb - d);
    if (s < 0) zk += (zb - d - zk) * Math.min(-s / ASYM_F_JS, 1) * (1 - ss(NONIDEAL.R_OT[0], NONIDEAL.R_OT[1], Rf));
    const hs = zk > 0.02 * H ? [0, 0.5 * zk, zk] : [0];
    return [...hs, zk + d / 3, zk + 2 * d / 3, zk + d, 0.5 * (zk + d + zb)];
  }
  // radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf at height h (on the side of s)
  function fieldRP(Rf, h, s = 0) {
    const zb = zBase(Rf), q = bendQ(Rf, h, zb, s);
    const T = bpOf(Rf);
    let R = Rf + T.A0 * q, ph = T.B0 * q / Rf;
    if (h > zb) { const f = tabS((h - zb) / R); R *= tabF(T.XI, f); ph += tabF(T.PHI, f); }
    return [R, ph];
  }
  // height chi reached after a travel time tau (TAU increases along the table, and tabF interpolates it linearly, so
  // the row is found by bisection over the rows and the place within it solved directly)
  function chiOfTau(tau, B = BP) {
    const T = B.TAU;
    if (!(tau > T[0])) return chiOfS(0);
    if (tau >= T[NT - 1]) return chiOfS(NT - 1.001);
    let lo = 0, hi = NT - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] > tau) hi = m; else lo = m; }
    return chiOfS(lo + (tau - T[lo]) / (T[hi] - T[lo]));
  }
  // point n (n >= 1) of the 2D Sobol sequence: van der Corput in base 2, and the second dimension from the
  // polynomial x + 1 (direction numbers 1, 3, 5, 15, 17, 51, ...)
  function sobol2(n) {
    let xi = 0, yi = 0, m = 1;
    for (let i = 1, k = n; k; i++, k >>= 1) {
      if (k & 1) { xi ^= 1 << (24 - i); yi ^= m << (24 - i); }
      m = (m << 1) ^ m;
    }
    return [xi / 16777216, yi / 16777216];
  }
  // heights chi_k at which the lines are sampled above the disk: a segment turns by at most 0.4 rad in
  // azimuth and grows by at most 15% in 1 + chi/C0; the samples are joined by cubic Bezier curves
  // (round 8: for each solution, kept with it)
  const chiS = (T) => {
    if (T.CHI_S) return T.CHI_S;
    const out = [0]; let chi = 0;
    while (chi < BP.CHIMAX) {
      const target = tabF(T.PHI, tabS(chi)) - 0.4;
      let lo = chi, hi = Math.min(BP.CHIMAX, (chi + BP.C0) * 1.15 - BP.C0);
      if (tabF(T.PHI, tabS(hi)) < target) for (let i = 0; i < 20; i++) { const m = 0.5 * (lo + hi); if (tabF(T.PHI, tabS(m)) < target) hi = m; else lo = m; }
      chi = hi; out.push(chi);
    }
    return (T.CHI_S = out);
  };
  const hg = (mu, g) => (1 - g * g) * Math.pow(1 + g * g - 2 * g * mu, -1.5);
  const HG0 = hg(0, 0.6);   // (the field lines evaluate phaseWind at every sample of every frame)
  const phaseWind = (mu) => { const x = 1.36 - 1.2 * mu, p = 0.64 / (x * Math.sqrt(x)) / HG0; return p / (1 + p / 8); };

  const reduceOS = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LOOKS = { model: 0, optical: 1, mir: 2, mm: 3, co: 4 };
  const LOOK_STAR = { model: 1, optical: 1, mir: 0.4, mm: 0.05, co: 0 };   // the star's glow in each look
  // The observed looks' gain from afar: their light falls off steeply outward (the millimetre's least), so that at the usual
  // distance only the inner few au showed. The gain grows (geometrically) from 1 within 8 au of the star to this at 60 au
  // and back to 1 beyond 120-300 au (the envelope); the star's own glow keeps its brightness. The mid-infrared's outer
  // disk stays dark whatever the gain (its 10 micron light falls by many orders of magnitude outward): a moderate gain
  // shows its rings to about 6 au.
  const LOOK_GAIN = { optical: 4, mir: 32, mm: 12 };
  // the CO line's displays (see uCoMode): a channel map at a velocity, the mean velocity (moment 1), the integrated
  // intensity (moment 0)
  const CO_MODES = { chan: 0, m1: 1, m0: 2 };
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);   // (a name from outside: not one of Object's own)
  const ja = () => (document.documentElement.lang || '').toLowerCase().startsWith('ja');   // (ja, ja-JP, ...)

  // reuse: the canvas, when the model is built anew on it after its WebGL context was lost and restored
  function init(box, reuse, restoredTime = 0) {
    // data-static renders one frame (used for the fallback image and screenshots)
    const reduce = reduceOS || 'static' in box.dataset;
    const canvas = reuse || document.createElement('canvas');
    // an application (its keys reach it under a screen reader), named shortly and described by two hidden texts: the
    // picture (see the end of draw; written only when it changes) and the keys
    if (!reuse) canvas.setAttribute('role', 'application');
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    // every listener of this build goes with it (see teardown); lost: the context is lost (nothing is drawn)
    const ac = new AbortController(), on = { signal: ac.signal };
    let lost = false;
    // the lookup maps (see MAP_GLSL) are float textures drawn on the GPU; without WebGL2 or float render
    // targets the static picture stays
    const fbFloat = gl && !!gl.getExtension('EXT_color_buffer_float'), fbHalf = fbFloat || (gl && !!gl.getExtension('EXT_color_buffer_half_float'));
    // (Disk Lab v2: why the live model did not start, for the page to show: box.dataset.fallbackError)
    // (a context lost as soon as it is made gives no extensions either: Safari loses the oldest contexts when a page or its
    // process holds too many, so say which it was)
    if (!gl || !fbHalf) {
      box.dataset.fallbackError = !gl ? 'no WebGL2 context' : gl.isContextLost() ? 'the WebGL2 context was lost as it was made (too many open?)'
        : 'no float render targets (' + (gl.getSupportedExtensions() || []).filter((e) => /color_buffer|float/i.test(e)).join(', ') + ')';
      box.classList.add('disk-fallback'); return;
    }
    if (!reuse) box.prepend(canvas);
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'disk-overlay'); overlay.setAttribute('aria-hidden', 'true');
    // (every text, and the scale bar, with a dark outline, so that they read over the bright inner disk, in an outburst, on
    // the CO line's bright maps and on the cut faces; the style goes with the overlay into the saved image)
    overlay.innerHTML = '<style>text{paint-order:stroke;stroke:rgba(6,9,18,.82);stroke-width:3.5px;stroke-linejoin:round}.disk-scale line.disk-halo{stroke:rgba(6,9,18,.6);stroke-width:3.5px}</style>'
      + '<g class="disk-field"></g><g class="disk-slice"></g><path class="disk-snowline" fill="none"/><text class="disk-label"></text><text class="disk-label disk-plabel"></text><g class="disk-scale"><line class="disk-halo"/><line/><text/></g><g class="disk-scale"><line class="disk-halo"/><line/><text/></g>';
    box.appendChild(overlay);
    const ring = overlay.querySelector('.disk-snowline'), label = overlay.querySelector('.disk-label'), fieldG = overlay.querySelector('.disk-field');
    const plabel = overlay.querySelector('.disk-plabel');
    // (the small rings that marked the planets from round 3 are gone in round 7: the planets glow instead, see uPlG)
    const [sgroup, sgroup2] = overlay.querySelectorAll('.disk-scale');   // the bar, and the one it replaces as it fades out

    // (round 10a) The page's flight recorder (app.js, its section of that name): what the engine is about to do and has done,
    // told in 'diskrec' events, dispatched synchronously, so that the page can write a step down before it is sent: a link,
    // the warm, a dear piece of GPU work and its end, a piece that has not ended after HUNG_MS while the page still runs, a
    // GL error after a target is made. id: a number for each step, its end carries the same
    const rec = (d) => box.dispatchEvent(new CustomEvent('diskrec', { detail: d }));
    let recId = 0;
    // (round 10a) a GL error looked for after a target or a program is made, never in the frames (in WebKit getError waits
    // for the GPU's process): OUT_OF_MEMORY above all; told to the recorder with what was made just before
    const glErr = (what) => { const e = gl.getError(); if (e && e !== gl.CONTEXT_LOST_WEBGL) rec({ k: e === gl.OUT_OF_MEMORY ? 'oom' : 'glerr', w: what, e }); return e; };
    // (round 10a) In WebKit a fence's creation, its status, a buffer's read back and a program's status are each a round trip
    // to the GPU's process, answered only once it has done everything sent before (a pipeline being made, a full queue): the
    // page waits meanwhile, up to 15 s, and the context is then lost (the research note of round 10a, section 2). Such calls
    // in the frames are timed, and one over SYNC_SLOW ms told to the recorder (slowSync(what, the time before the call))
    const SYNC_SLOW = 5;
    // (round 10a, dev.6, for checks: box.diskFenceLog(true) or data-fencelog="1" before the engine is made: each piece's fence
    // told ('diskfence') with the calls that waited in the script between its sending and its seeing (syncLog: every call timed
    // here, with its start and length))
    let fenceLog = box.dataset.fencelog === '1';
    const syncLog = [];
    const slowSync = (w, t0) => {
      const now = performance.now(), ms = now - t0;
      if (ms > SYNC_SLOW) rec({ k: 'sync', w, ms });
      if (fenceLog) { syncLog.push({ w, t0: Math.round(t0 * 10) / 10, ms: Math.round(ms * 10) / 10 }); if (syncLog.length > 400) syncLog.splice(0, 100); }
    };
    const compile0 = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const compile = (type, src) => { const s = compile0(type, src); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(s)); return s; };
    // (round 10a: each link told to the recorder, before and after, with its time and, if it fails, the head of its log;
    // where the browser has no KHR_parallel_shader_compile the status checks wait for the compiler, in WebKit in the GPU's
    // process, so the time is the compiler's)
    const link = (fs, name = '') => {
      const id = ++recId, t0 = performance.now();
      rec({ k: 'link', ph: 0, id, w: name });
      try {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
        rec({ k: 'link', ph: 1, id, w: name, ms: performance.now() - t0, ok: 1 });
        return p;
      } catch (e) { rec({ k: 'link', ph: 1, id, w: name, ms: performance.now() - t0, ok: 0, log: String(e && e.message || e).slice(0, 300) }); throw e; }
    };
    // The turbulence's phase clock (see fpPhase): per band of lifetimes 4^(i-5), the count of lifetimes elapsed and the
    // fraction of the current one. The count wraps at 2^30 (the noise takes it as a seed: one jump after 2^30 lifetimes,
    // some 30 years at x1 for the fastest band), so it never leaves int32.
    const phaseGenerations = new Int32Array(16), phaseResiduals = new Float32Array(16);
    const phasePeriods = Float32Array.from({ length: 16 }, (_, i) => 4 ** (i - 5));
    const phasePrograms = new WeakMap();
    let phaseClockTime = NaN;
    function uploadPhaseClock(p) {
      if (time !== phaseClockTime) {
        for (let i = 0; i < 16; i++) {
          const band = i - 5, q = Math.floor(time / phasePeriods[i]);
          const r = time / phasePeriods[i] - q + Math.fround(Math.fround(0.37) * band), carry = Math.floor(r);
          const g = q + carry, m = 2 ** 30;
          phaseGenerations[i] = ((g % m) + m) % m; phaseResiduals[i] = r - carry;
        }
        phaseClockTime = time;
      }
      let cached = phasePrograms.get(p);
      if (!cached) {
        cached = { generation: gl.getUniformLocation(p, 'uFpGeneration'), residual: gl.getUniformLocation(p, 'uFpResidual'), period: gl.getUniformLocation(p, 'uFpPeriod'), time: NaN };
        phasePrograms.set(p, cached);
        gl.uniform1fv(cached.period, phasePeriods);
      }
      if (cached.time !== time) {
        gl.uniform1iv(cached.generation, phaseGenerations); gl.uniform1fv(cached.residual, phaseResiduals);
        cached.time = time;
      }
    }
    const uniforms = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    // (round 10a: with data-math="safe", the main programs with SAFE_MATH, see the end of FS)
    const FSM = box.dataset.math === 'safe' ? FS.replace('#version 300 es\n', '#version 300 es\n#define SAFE_MATH\n') : FS;
    const prog = link(FSM, 'FS'), progDisk = link(DISKMAP_FS, 'disk'), progWind = link(WINDMAP_FS, 'wind'), progEnv = link(ENVMAP_FS, 'env');
    // the eddies' volume texture (TURB3_FS, then SHADE3_FS), NB3 layers per draw: 8 where the driver allows, else 4
    const NB3 = gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 8 && gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) >= 8 ? 8 : 4;
    const progT3 = link(TURB3_FS(NB3), 'turb3'), progS3 = link(SHADE3_FS(NB3), 'shade3'), progWS = link(WSTR_FS(NB3), 'wstr');
    const UWS = uniforms(progWS, ['uResW', 'uLayer0', 'uTime', 'uSeed']);
    const UT3 = uniforms(progT3, ['uRes3', 'uLayer0', 'uTime', 'uSeed', 'uCam', 'uPixA']), US3 = uniforms(progS3, ['uRes3', 'uLayer0', 'uT3']);
    gl.useProgram(progS3); gl.uniform1i(US3.uT3, 5);
    const UNAMES = ['uRayB', 'uCtMax', 'uMarch', 'uCoIt', 'uCtIt', 'uCoRec', 'uCoPass', 'uCoG0', 'uCoP', 'uCoDith', 'uProbe', 'uCutA', 'uFacePass', 'uFaceRdy', 'uFaceRes', 'uRes', 'uTime', 'uCam', 'uBasis', 'uTanHalf', 'uRSnow', 'uLum', 'uExposure', 'uStar', 'uSteps', 'uSeed', 'uPx', 'uClump', 'uVapor', 'uMode', 'uDiskMap', 'uWindMap', 'uSlice', 'uSliceQ', 'uSliceN', 'uSliceR', 'uSliceZ',
      'uNP', 'uPl', 'uPlTrap', 'uPlGap', 'uPlRim', 'uPlV', 'uPlVa', 'uPlG', 'uGapT', 'uThermo', 'uGapR', 'uEnv', 'uEnvMap', 'uSliceOff', 'uSliceFace', 'uLook', 'uComp', 'uTurb3', 'uJit', 'uEnv3', 'uMS', 'uWStr', 'uWindLow', 'uAccMap', 'uAcc', 'uAccV', 'uCoMode', 'uCoV', 'uCoRange', 'uCoK', 'uWindVel', 'uMag', 'uMagAxis', 'uMagE1', 'uMagT', 'uPuffT', 'uPuff', 'uStarK', 'uMat', 'uPlVq', 'uCpd', 'uJet', 'uJetLow', 'uJetT', 'uBg', 'uSky', 'uLit', 'uFx', 'uFocus', 'uSplit', 'uKick0', 'uKickK', 'uKickN', 'uRowOff'];
    const U0 = uniforms(prog, UNAMES);
    const progShow = link(SHOW_FS, 'show'), progBloom = link(BLOOM_FS, 'bloom');
    // (round 8) the bloom's targets, a quarter of accT's size (made with it): A on unit 18 (for SHOW_FS), B on unit 19
    let bloomA = null, bloomB = null;
    const UB = uniforms(progBloom, ['uSrc', 'uPass', 'uSrcPart', 'uDst', 'uSrcTexel', 'uStep']);
    function bloomTargets() {
      const w = Math.max(1, Math.ceil(accT.w / 4)), h = Math.max(1, Math.ceil(accT.h / 4));
      if (bloomA && bloomA.w === w && bloomA.h === h) return;
      for (const t of [bloomA, bloomB]) if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
      bloomA = target(w, h, gl.RGBA16F, gl.CLAMP_TO_EDGE); bloomB = target(w, h, gl.RGBA16F, gl.CLAMP_TO_EDGE); glErr('bloom');
      gl.activeTexture(gl.TEXTURE18); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
      gl.activeTexture(gl.TEXTURE19); gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
      gl.activeTexture(gl.TEXTURE2);
    }
    // the bright parts' glow for the picture in accT now (the volume's rW x rH)
    function bloomPass() {
      bloomTargets();
      const bw = Math.max(1, Math.ceil(rW / 4)), bh = Math.max(1, Math.ceil(rH / 4));
      gl.useProgram(progBloom);
      gl.uniform2f(UB.uDst, bw, bh); gl.viewport(0, 0, bw, bh);
      gl.uniform1i(UB.uSrc, 6); gl.uniform1i(UB.uPass, 0);
      gl.uniform4f(UB.uSrcPart, rW / accT.w, rH / accT.h, (rW - 0.5) / accT.w, (rH - 0.5) / accT.h);
      gl.uniform2f(UB.uSrcTexel, 1 / accT.w, 1 / accT.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb); gl.drawArrays(gl.TRIANGLES, 0, 3);
      // (the taps' spacing: 4 taps either way reach BLOOM.R of the picture's height, in the bloom's texels, at least one)
      const step = Math.max(1, BLOOM.R * bh / 4);
      gl.uniform2f(UB.uSrcTexel, 1 / bloomA.w, 1 / bloomA.h); gl.uniform1f(UB.uStep, step);
      gl.uniform1i(UB.uSrc, 18); gl.uniform1i(UB.uPass, 1); gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fb); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.uniform1i(UB.uSrc, 19); gl.uniform1i(UB.uPass, 2); gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return [bw / bloomA.w, bh / bloomA.h];
    }
    gl.useProgram(progShow); gl.uniform1i(gl.getUniformLocation(progShow, 'uAcc'), 6); gl.uniform1i(gl.getUniformLocation(progShow, 'uFace'), 11);
    gl.uniform1i(gl.getUniformLocation(progShow, 'uBloom'), 18);
    const uShowBloom = gl.getUniformLocation(progShow, 'uBloomP'), uShowTone = gl.getUniformLocation(progShow, 'uTone');
    const uShowDev = gl.getUniformLocation(progShow, 'uDev'), uShowFace = gl.getUniformLocation(progShow, 'uFaceOn'), uShowPart = gl.getUniformLocation(progShow, 'uAccPart');
    const uShowTexel = gl.getUniformLocation(progShow, 'uTexel'), uShowSoft = gl.getUniformLocation(progShow, 'uSoft');
    // (a texel of nothing on units 11 and 12 (the cut face, see faceT) until the face is first drawn, and on unit 12 while
    // faceA is drawn into: the samplers must not point at no texture)
    const noFace = gl.createTexture();
    gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, noFace); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, noFace); gl.activeTexture(gl.TEXTURE2);
    const progAE = link(AE_FS, 'ae'), uAeSrc = gl.getUniformLocation(progAE, 'uSrc');
    gl.useProgram(progAE); gl.uniform1i(gl.getUniformLocation(progAE, 'uAcc'), 6);
    // (round 10a) the picture's health (see HEALTH_FS): asked for by the page (healthWanted), measured after the next frame's
    // finish into its own small target, copied to a buffer, and read back once its fence has passed (healthRead), a frame or
    // two later, without waiting; 'diskhealth' tells the page
    const progHealth = link(HEALTH_FS, 'health'), uHealthSrc = gl.getUniformLocation(progHealth, 'uSrc');
    gl.useProgram(progHealth); gl.uniform1i(gl.getUniformLocation(progHealth, 'uAcc'), 6);
    let healthT = null, healthBuf = null, healthSync = null, healthWanted = 0, healthOf = null;
    const healthPx = new Uint8Array(HEALTH_W * HEALTH_H * 4);
    function healthPass(info) {
      firstUse('health');
      if (!healthT) { healthT = target(HEALTH_W, HEALTH_H, gl.RGBA8, gl.CLAMP_TO_EDGE); healthBuf = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, healthBuf); gl.bufferData(gl.PIXEL_PACK_BUFFER, healthPx.length, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, healthT.fb); gl.viewport(0, 0, HEALTH_W, HEALTH_H);
      gl.useProgram(progHealth); gl.uniform2f(uHealthSrc, rW, rH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, healthBuf); gl.readPixels(0, 0, HEALTH_W, HEALTH_H, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      healthSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      healthOf = info; healthWanted = 0;
    }
    function healthRead() {
      if (!healthSync || lost) return;
      const tw = performance.now(), hs = gl.clientWaitSync(healthSync, 0, 0); slowSync('clientWaitSync health', tw);
      if (hs === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(healthSync); healthSync = null;
      const ts = performance.now();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, healthBuf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, healthPx); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      slowSync('getBufferSubData health', ts);
      let bad = 0, neg = 0, mx = 0, worst = 0, chans = 0;
      const where = [];   // (round 10a: the cells with values not finite, [column, row from the top, share in %, channels], at most 12)
      for (let i = 0; i < healthPx.length; i += 4) {
        if (healthPx[i]) { bad++; const c = Math.round(healthPx[i + 3] / 32); chans |= c; if (where.length < 12) { const k = i / 4; where.push([k % HEALTH_W, HEALTH_H - 1 - Math.floor(k / HEALTH_W), Math.round(healthPx[i] / 2.55), c]); } }
        if (healthPx[i + 1]) neg++; mx = Math.max(mx, healthPx[i + 2]); worst = Math.max(worst, healthPx[i]);
      }
      box.dispatchEvent(new CustomEvent('diskhealth', { detail: { cells: HEALTH_W * HEALTH_H, grid: [HEALTH_W, HEALTH_H], bad, neg, worst: Math.round(worst / 2.55) / 100, max: Math.round(mx / 255 * 4 * 100) / 100, chans, where, ...healthOf } }));
    }
    // the FULL program, compiled in the background where the driver can (KHR_parallel_shader_compile), otherwise
    // when first needed; null until it is ready, false if it failed (the usual program then stands in). A single
    // frame (reduced motion, a snapshot) waits for it, since no later frame would replace it.
    const pcomp = gl.getExtension('KHR_parallel_shader_compile');
    let full = null, fullP = null, fullWait = false, fullRec = null;
    const startFull = () => {
      // (round 10a: told to the recorder before it is sent; its end when the status is known, below)
      fullRec = { id: ++recId, t0: performance.now() };
      rec({ k: 'link', ph: 0, id: fullRec.id, w: 'FULL', pc: pcomp ? 1 : 0 });
      const p = gl.createProgram();
      gl.attachShader(p, compile0(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile0(gl.FRAGMENT_SHADER, FSM.replace('#version 300 es\n', '#version 300 es\n#define FULL\n')));
      gl.linkProgram(p); fullP = p;
    };
    function fullProgram() {
      if (full !== null) return full;
      if (!fullP) startFull();
      // (round 10a, dev.6: with reduced motion too, which linked it here while the page waited, 47 ms on the M1 Max: no frame needs
      // it before its warm now, see fullReady)
      if (pcomp && !fullWait) { const ts = performance.now(), done = gl.getProgramParameter(fullP, pcomp.COMPLETION_STATUS_KHR); slowSync('COMPLETION_STATUS', ts); if (!done) return null; }
      const okF = gl.getProgramParameter(fullP, gl.LINK_STATUS);
      if (fullRec) { rec({ k: 'link', ph: 1, id: fullRec.id, w: 'FULL', ms: performance.now() - fullRec.t0, ok: okF ? 1 : 0, ...(okF ? {} : { log: String(gl.getProgramInfoLog(fullP)).slice(0, 300) }) }); fullRec = null; }
      if (!okF) { console.error('disk3d:', gl.getProgramInfoLog(fullP)); full = false; return full; }
      full = { prog: fullP, U: uniforms(fullP, UNAMES) };
      gl.useProgram(fullP); gl.uniform1i(gl.getUniformLocation(fullP, 'uFaceA'), 12); gl.uniform1i(full.U.uDiskMap, 0); gl.uniform1i(full.U.uGapT, 14); gl.uniform1i(full.U.uThermo, 15); gl.uniform1i(full.U.uWindMap, 1); gl.uniform1i(full.U.uEnvMap, 3); gl.uniform1i(full.U.uTurb3, 4); gl.uniform1i(full.U.uEnv3, 7); gl.uniform1i(full.U.uWStr, 8); gl.uniform1i(full.U.uAccMap, 9); gl.uniform1i(full.U.uWindVel, 10);
      gl.uniform1i(full.U.uSky, 16);   // (round 8: the sky's map, see BG)
      gl.uniform1i(gl.getUniformLocation(fullP, 'uCoAcc'), CO_UNIT);   // (round 9: the moments' sums, see coAccOf)
      gl.uniform1i(gl.getUniformLocation(fullP, 'uState'), SPLIT.UNIT);   // (round 10a: the march's state in kicks, see SPLIT)
      return full;
    }
    // (round 9) The FULL program's first use. Linking it is not all: ANGLE's Metal backend builds a pipeline state for each
    // blend state at the first draw with it, in the GPU process and before that frame's work: 1.5 to 1.7 s on the M1 Max
    // (round 9's slowest-ray check: the first frame of the mid-infrared look, and near the star the first frame with
    // blending; the frames after them 2 to 120 ms). So it is linked in the background after the first frame (with
    // KHR_parallel_shader_compile; its status is polled, the link never waited for), and once linked, at an idle moment when
    // no frame is being drawn in bands, it draws one pixel of the present view (a 1 x 1 scissor) in each blend state
    // (warmFull), the next frame waiting for that work (warmSync) so that no frame is charged with it. A look that needs it
    // is not switched to before (the look in view stays, dimmed, and 'diskwait' tells the page); nor, in the model's look,
    // the parts drawn by it (the cut, a planet close up, the field lines), left out meanwhile. Without the extension it is
    // linked and warmed at the first idle moment. Round 9's checks: after a restored context the warm waited for idle
    // moments that never came while a script drew (diskSettle), and the cut was drawn unwarmed, 0.4 and 0.9 s frames; the
    // warm is now asked for from the animation frames too (warmLater, not idle), and a script's frames warm first
    // (warmNow). The warm draws into 1 x 1 targets of its own (warmV, warmT), so it may come between any two frames.
    let fullWarm = false, warming = false, warmSync = null, warmQueued = false, waitShown = false, warmT = null, warmV = null, warmC = null, warmAnnounced = false, warmSent = 0;
    // (round 10a, dev.6: FULL ready to draw a frame: its warm sent and its pipelines made)
    const fullReady = () => fullWarm && !warmSync;
    const warmLater = (f) => setTimeout(f, 50);
    const variants = new Set();
    const UD = uniforms(progDisk, ['uMapRes', 'uTime', 'uSeed', 'uCam', 'uPixA', 'uNP', 'uPl', 'uPlLight', 'uGapT', 'uGapR', 'uWakeX', 'uAccK', 'uAccC']);
    // the starlight on the planets' gaps (see gapLight), a row per planet, on texture unit 13
    const plLightT = gl.createTexture();
    gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_2D, plLightT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 128, PLANETS.MAX, 0, gl.RED, gl.FLOAT, new Float32Array(128 * PLANETS.MAX).fill(1));
    gl.useProgram(progDisk); gl.uniform1i(UD.uPlLight, 13); gl.uniform1i(UD.uGapT, 14);
    // (round 7) the temperature's table (see tInt4 in the GLSL), on unit 15, from the script's own laws (tInt4JS): T_acc with
    // the floor, and T_i for the star's own luminosity, in K (half floats, linearly filtered)
    {
      const NR = 512, NZ = 128, ln0 = Math.log(0.02), dln = Math.log(2000) / (NR - 1), d = new Float32Array(NR * NZ * 2);
      for (let j = 0; j < NR; j++) {
        // (as tInt4JS, with what depends on R alone taken out of the loop over the heights)
        const R = Math.exp(ln0 + j * dln), ti = Math.pow(THERMO.KI * betaIrrJS(R) / (R * R), 0.25), m = mriAmpJS(R), za = zAccHJS(R);
        const ua = Math.max(1 - erfJS(za * Math.SQRT1_2), 1e-6), tm4 = THERMO.KM / (R * R * R), tv = THERMO.KV * Math.pow(R, -0.9), tv4 = tv * tv * tv * tv, f4 = Math.pow(THERMO.T_FLOOR, 4);
        for (let k = 0; k < NZ; k++) {
          const az = k * 8 / (NZ - 1), u = 1 - erfJS(az * Math.SQRT1_2);
          const acc = (1 - m) * tm4 * (az < za ? 1 : (THERMO.TAU_HEAT * u / ua + 0.57735) / (THERMO.TAU_HEAT + 0.57735)) + m * tv4 * (2 * u - u * u + 0.003) / 1.003 + f4;
          d[2 * (k * NR + j)] = Math.pow(acc, 0.25);
          d[2 * (k * NR + j) + 1] = ti;
        }
      }
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, NR, NZ, 0, gl.RG, gl.FLOAT, d);
    }
    // the gaps' table (see gapT): ln of the factor and the slope, on unit 14
    const gapTT = gl.createTexture(), gapTD = new Float32Array(2 * GT_N);
    gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, gapTT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, GT_N, 1, 0, gl.RG, gl.FLOAT, gapTD);
    // a full-screen triangle, shared by the passes
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const fLinear = !!gl.getExtension('OES_texture_float_linear');
    // (round 10a: filter, NEAREST for a target only read texel by texel: a 32-bit float texture with LINEAR is incomplete
    // where such textures cannot be filtered (no OES_texture_float_linear, iPhones: WebKit bug 252359), and a texel fetch
    // from an incomplete texture gives (0, 0, 0, 1))
    function target(w, h, fmt, wrapT, filter = gl.LINEAR) {
      gl.activeTexture(gl.TEXTURE2);      // set up on a spare unit: units 0 and 1 hold the maps the march reads
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('disk3d: map target incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }
    // a volume target (w x h x d texels, azimuth periodic), drawn NB3 layers at a time: one framebuffer per group. Where
    // the driver cannot draw into the one- or two-channel format, the four-channel one stands in.
    function target3(w, h, d, fmt) {
      gl.activeTexture(gl.TEXTURE2);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texStorage3D(gl.TEXTURE_3D, 1, fmt, w, h, d);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      const fbs = [];
      for (let z0 = 0; z0 < d; z0 += NB3) {
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        const bufs = Array.from({ length: NB3 }, (_, k) => gl.COLOR_ATTACHMENT0 + k);
        bufs.forEach((a, k) => gl.framebufferTextureLayer(gl.FRAMEBUFFER, a, tex, 0, z0 + k));
        gl.drawBuffers(bufs);
        fbs.push({ fb, z0 });
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); fbs.forEach((f) => gl.deleteFramebuffer(f.fb)); gl.deleteTexture(tex);
          if (fmt !== gl.RGBA16F) return target3(w, h, d, gl.RGBA16F);
          throw new Error('disk3d: volume target incomplete');
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbs, w, h, d };
    }
    const drop3 = (t) => { if (t) { t.fbs.forEach((f) => gl.deleteFramebuffer(f.fb)); gl.deleteTexture(t.tex); } };
    // the envelope's streamers (ENV3_FS, unit 7): 96 x 128 x 80 texels (4 MB), made once, in idle time after the start or
    // when the envelope first shows
    let env3T = null;
    function makeEnv3() {
      if (env3T || lost || bandJob || gl.isContextLost()) return;   // (round 9: not between the bands of a frame: it binds a texture of its own)
      const p = link(ENV3_FS(NB3), 'env3'), t = target3(96, 128, 80, gl.RG16F), uL = gl.getUniformLocation(p, 'uLayer0');
      glErr('env3');
      gl.useProgram(p); gl.uniform3f(gl.getUniformLocation(p, 'uRes3'), t.w, t.h, t.d); gl.uniform1f(gl.getUniformLocation(p, 'uSeed'), opt.seed);
      gl.viewport(0, 0, t.w, t.h);
      for (const f of t.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(uL, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      t.fbs.forEach((f) => gl.deleteFramebuffer(f.fb)); t.fbs = []; gl.deleteProgram(p);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_3D, t.tex);
      env3T = t;
    }
    const windMapT = target(512, 512, fbFloat && fLinear ? gl.RGBA32F : gl.RGBA16F, gl.CLAMP_TO_EDGE);
    // the wind's velocity (unit 10, for the CO line), drawn with the wind map into its second attachment
    const windVelT = (() => {
      gl.activeTexture(gl.TEXTURE10);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, windMapT.w, windMapT.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, windMapT.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('disk3d: wind map target incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex };
    })();
    // (round 8) the solutions' texture (see uBPT), bound to unit 2 only while the wind map is drawn (every unit is in use)
    const bpT = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bpT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 2 * NBP, 0, gl.RGBA, gl.FLOAT, new Float32Array([
      ...BPL.flatMap((T) => T.XI.flatMap((x, i) => [x, T.PHI[i], T.TAU[i], T.LNEK[i]])),
      ...BPL.flatMap((T) => T.F.flatMap((F, i) => [F, T.G[i], T.XIP[i], 0]))]));
    gl.useProgram(progWind);
    gl.uniform1i(gl.getUniformLocation(progWind, 'uBPT'), 2);
    gl.uniform4fv(gl.getUniformLocation(progWind, 'uBPL'), new Float32Array(BPL.flatMap((T) => [T.LAM, T.A0, T.B0, 0])));
    gl.uniform2f(gl.getUniformLocation(progWind, 'uMapRes'), windMapT.w, windMapT.h);
    // the wind map (and its velocities) for the asymmetry's share now; drawn again when it changes (during its fade)
    const uAsymSW = gl.getUniformLocation(progWind, 'uAsymS');
    let windMapS = null;
    function drawWindMap(s) {
      if (s === windMapS) return;
      windMapS = s;
      gl.useProgram(progWind); gl.uniform1f(uAsymSW, s);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bpT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, windMapT.fb); gl.viewport(0, 0, windMapT.w, windMapT.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    drawWindMap(0);   // (the first frame draws it for the state's asymmetry)
    // (round 8) the sky of a star-forming region (see BG, SKY_FS): drawn once, the first time it is asked for, on unit 16
    // (an empty texture there until then)
    let skyT = null;
    gl.activeTexture(gl.TEXTURE16); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    function skyMap() {
      if (skyT) return;
      const pS = link(SKY_FS, 'sky');
      skyT = target(BG.W, BG.H, gl.RGBA16F, gl.CLAMP_TO_EDGE);
      glErr('sky');
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);   // (target() left it bound to unit 2: the longitude wraps)
      gl.useProgram(pS);
      gl.uniform2f(gl.getUniformLocation(pS, 'uMapRes'), BG.W, BG.H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, skyT.fb); gl.viewport(0, 0, BG.W, BG.H); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE16); gl.bindTexture(gl.TEXTURE_2D, skyT.tex); gl.activeTexture(gl.TEXTURE2);
      gl.deleteProgram(pS);
    }
    // the envelope map (see ENVMAP_FS), drawn once, on unit 3
    const envMapT = target(256, 128, gl.RGBA16F, gl.CLAMP_TO_EDGE);
    gl.useProgram(progEnv);
    gl.uniform2f(gl.getUniformLocation(progEnv, 'uMapRes'), envMapT.w, envMapT.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, envMapT.fb); gl.viewport(0, 0, envMapT.w, envMapT.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, envMapT.tex);
    gl.useProgram(prog);
    gl.uniform1i(U0.uDiskMap, 0); gl.uniform1i(U0.uGapT, 14); gl.uniform1i(U0.uThermo, 15); gl.uniform1i(U0.uWindMap, 1); gl.uniform1i(U0.uTurb3, 4); gl.uniform1i(U0.uWStr, 8); gl.uniform1i(U0.uAccMap, 9);
    gl.uniform1i(U0.uSky, 16); gl.uniform1i(U0.uEnvMap, 3); gl.uniform1i(U0.uEnv3, 7);   // (round 8: the envelope in both programs)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, windMapT.tex);
    // disk map: 2048 texels in ln R (0.0027 per texel) resolve the sheared structure down to the footprint
    // of a pixel at the usual distances on a desktop panel; a narrower canvas (a phone) has larger pixels
    // and gets 1024 or 512, since the map costs the same whatever the size of the picture. 256 around
    // (4 per cell of the finer octave).
    // The eddies' volume (texture units 5 and 4), over the turbulent inner disk (R from 0.05 to 0.6 au): 352 x 160 x 40
    // texels on a desktop panel (about 7 texels per radial cell, 4 around, 6 per cell in height), fewer with a smaller
    // disk map; 11 MB.
    let diskMapT = null, accMapTex = null, t3a = null, t3b = null;
    const MAX3 = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    function diskTarget() {
      // (Disk Lab v2: from the canvas at a nominal render scale of one half, so that a change of the scale does not
      // rebuild the maps and the eddies' volume: the scale moves with the frame time)
      const nx = Math.min(2048, Math.max(512, 2 ** Math.ceil(Math.log2(canvas.width * 0.5 * 1.6))));
      if (diskMapT && diskMapT.w === nx) return;
      if (diskMapT) { gl.deleteFramebuffer(diskMapT.fb); gl.deleteTexture(diskMapT.tex); gl.deleteTexture(accMapTex); }
      diskMapT = target(nx, 256, gl.RGBA16F, gl.REPEAT);
      // the accretion layers' streaks (unit 9), drawn with the disk map into its second attachment
      gl.activeTexture(gl.TEXTURE9);
      accMapTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, accMapTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, nx, 256);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, diskMapT.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, accMapTex, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('disk3d: map target incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(progDisk); gl.uniform2f(UD.uMapRes, diskMapT.w, diskMapT.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, diskMapT.tex);
      drop3(t3a); drop3(t3b);
      const [w3, h3] = [nx >= 2048 ? 352 : nx >= 1024 ? 176 : 120, nx >= 2048 ? 160 : 120].map((v) => Math.min(v, MAX3));
      t3a = target3(w3, h3, 40, gl.R16F); t3b = target3(w3, h3, 40, gl.RG16F); glErr('maps');
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_3D, t3a.tex);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_3D, t3b.tex);
    }
    // the eddies for this moment and view (their detail is faded by the footprints of the pixels)
    // the wind's streamers (WSTR_FS, unit 8): 160 x 64 x 48 texels (about 4.5 per radial cell, 13 around, 4 per lifetime)
    const wstrT = target3(160, 64, 48, gl.R16F);
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_3D, wstrT.tex);
    function windPass() {
      gl.useProgram(progWS);
      gl.uniform3f(UWS.uResW, wstrT.w, wstrT.h, wstrT.d); gl.uniform1f(UWS.uTime, time); uploadPhaseClock(progWS); gl.uniform1f(UWS.uSeed, opt.seed);
      gl.viewport(0, 0, wstrT.w, wstrT.h);
      for (const f of wstrT.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(UWS.uLayer0, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // (round 9: sent in submissions of EDDY_FLUSH layers: the pass took up to 126 ms on the M1 Max at the planet close up,
    // 13 to 34 on average, every frame while the clock runs, whatever the render scale; one submission of all its layers
    // would be some 250 ms on a phone)
    const EDDY_FLUSH = 8;
    let eddyEvery = 1, eddyTick = 0;
    function eddyPass() {
      gl.useProgram(progT3);
      gl.uniform3f(UT3.uRes3, t3a.w, t3a.h, t3a.d); gl.uniform1f(UT3.uTime, time); uploadPhaseClock(progT3); gl.uniform1f(UT3.uSeed, opt.seed);
      gl.uniform3fv(UT3.uCam, cam); gl.uniform1f(UT3.uPixA, 2 * Math.tan(opt.fov / 2) / rH);
      gl.viewport(0, 0, t3a.w, t3a.h);
      let k = 0;
      for (const f of t3a.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(UT3.uLayer0, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); if (++k % EDDY_FLUSH === 0) gl.flush(); }
      gl.useProgram(progS3); gl.uniform3f(US3.uRes3, t3b.w, t3b.h, t3b.d);
      for (const f of t3b.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(US3.uLayer0, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); if (++k % EDDY_FLUSH === 0) gl.flush(); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // --- field lines and wind parcels: vector strokes in the SVG overlay, from the wind solution ---
    // Each line is a Catmull-Rom spline through its samples, written as cubic Bezier segments; segments are
    // grouped into NB opacity levels, one halo and one core path per level, so the overlay is a fixed set of
    // path elements updated each frame (only those whose data changed). The levels are fine enough (steps of 3% of
    // the core's opacity) that the brightness changes smoothly along a line; the segments end flat (butt caps), so
    // where a line passes from one level to the next the two paths meet without overlapping (the splines are smooth
    // across the joints). The parcels of the wind (and of the envelope) are marks of the flow, not clumps of gas (round 8:
    // small arrows, see ARROW; short dashes with tails before).
    let showField = !('nofield' in box.dataset);
    // geometry: NL field lines whose feet come from a 2D Sobol sequence, quasi-uniform in ln R (0.2 to 25 au)
    // and azimuth; each line is drawn up to ZTOP, with points through the disk (diskHeights) and the heights CHI_S
    // above it; wind parcels carry a release phase in [0, 1). Below, two sets that fade into each other with the wind's
    // asymmetry (opt.asym): with it, every other line and half the parcels, at LOW_LINES of the brightness (the weaker
    // wind of a field aligned with the rotation); without it, the mirror of the upper side. k(a): a line's or a parcel's
    // brightness for the asymmetry a (0 to 1).
    const NL = 28, ZTOP = ZB_JS, NB = 48, NBM = 24, lines = [], parcels = [], LOW_LINES = 0.3;   // levels of the lines and of the marks
    for (let i = 0; i < NL; i++) {
      const [u1, u2] = sobol2(i + 1);
      const Rf = 0.2 * Math.pow(25 / 0.2, u1), phi0 = 2 * Math.PI * u2;
      lines.push({ Rf, phi0, side: 1, k: () => 1 });
      lines.push({ Rf, phi0, side: -1, k: i % 2 === 0 ? (a) => 1 - a + LOW_LINES * a : (a) => 1 - a });
      // (round 8: 4 a line on each side, as arrows; 8 as dashes before)
      for (let m = 0; m < 4; m++) parcels.push({ Rf, phi0, side: 1, u: ((m + 0.37 * i) / 4) % 1, k: () => 1 });
      for (let m = 0; m < 4; m++) parcels.push({ Rf, phi0, side: -1, u: ((m + 0.37 * i) / 4) % 1, k: (a) => 1 - a });
      if (i % 2 === 0) for (let m = 0; m < 2; m++) parcels.push({ Rf, phi0, side: -1, u: ((m + 0.21 * i) / 2) % 1, k: (a) => LOW_LINES * a });
    }
    // the surface accretion's marks (see ACC): NACC on each side, moving with the laminar inflow along the accretion
    // layer's centre, in amber to tell them from the wind's. A mark starts at R0 and moves inward at k c_s (c_s =
    // H0 R^1/4 v_K) while it turns with the disk: R^5/4 = R0^5/4 - (5/4) k H0 Omega1 t, and its azimuth gains
    // 4 (R^-1/4 - R0^-1/4) / (k H0) (some ten turns from 6 au in); it fades in, and out by ACC.R_END, and starts again.
    // They are marks of the flow, as the wind's are, drawn with the gas (the component), hidden behind the pebble sheet
    // and the cut faces, and only in the model's look.
    const NACC = 36, accMarks = [];
    for (let i = 0; i < NACC; i++) {
      const [u1, u2] = sobol2(i + 71);
      const R0 = 1.2 * Math.pow(20 / 1.2, u1), phi0 = 2 * Math.PI * u2;   // (round 8: to 20 au, as the layer goes on outside the dead zone)
      accMarks.push({ R0, phi0, side: 1, u: (0.618034 * i) % 1 });
      accMarks.push({ R0, phi0: phi0 + 2.4, side: -1, u: (0.618034 * i + 0.5) % 1 });
    }
    // starlight reaching a point at radius R and height h: softened falloff with the distance from the star,
    // shadowed inside the disk (optical depth toward the star)
    const starlight = (R, h) => {
      const Hs = MODEL.H0 * Math.pow(R, 1.25);
      const tau = Math.exp(Math.min(Math.max(MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) - 0.5 * h * h / (Hs * Hs), -30), 30));
      return (0.2 + 0.8 * Math.exp(-tau)) / (1 + Math.pow((R * R + h * h) / 225, WIND_SOFT / 2));
    };
    // A line keeps its shape in the frame rotating with its foot, so its samples are computed once: radius,
    // azimuth relative to the foot, height, and the brightness that does not depend on the view (brightest
    // where the line leaves the disk; the wound-up part above fades out, and so does the part near the top,
    // beyond the end of the table and beyond the edge of the disk; weaker below). Each frame then only
    // rotates, projects and applies the scattering angle and the sheet.
    // (with the asymmetry the two sides differ, so the samples are made again when its share changes: shapeLines)
    let linesS = null;
    function shapeLines(sNow) {
      if (sNow === linesS) return;
      linesS = sNow;
    for (const L of lines) {
      const s = L.side * sNow, zb = zBase(L.Rf), r0 = r0Of(L.Rf, s), inDisk = diskHeights(L.Rf, s), CHI_S = chiS(bpOf(L.Rf));
      const chiEnd = Math.min(Math.max((ZTOP - zb) / r0, 0.5), BP.CHIMAX);
      L.r0 = r0; L.pts = [];
      for (let j = 0, k = 0; ; j++) {
        let h, chi = 0;
        if (j < inDisk.length) h = inDisk[j];
        else { if (k >= CHI_S.length) break; chi = Math.min(CHI_S[k++], chiEnd); h = zb + r0 * chi; }
        const [R, dphi] = fieldRP(L.Rf, h, s);
        const fade = Math.exp(-(h - Math.min(h, zb)) / (1.5 * r0 + 2)) * (1 - ss(0.85 * chiEnd, chiEnd, chi)) * (1 - ss(0.6, 1, chi / BP.CHIMAX)) * (1 - ss(0.75 * RB_JS, RB_JS, R));
        L.pts.push({ R, dphi, z: L.side * h, b: fade * starlight(R, h), c: Math.cos(dphi), s: Math.sin(dphi) });
        if (chi >= chiEnd) break;
      }
    }
    }
    shapeLines(0);
    // coordinates are written in tenths of a pixel as integers (cheaper than toFixed): the group is scaled
    // by 0.1, so the stroke widths and dot radii below are ten times their size in pixels
    fieldG.setAttribute('transform', 'scale(0.1)');
    const mkPath = (attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'path'); for (const k in attrs) e.setAttribute(k, attrs[k]); fieldG.appendChild(e); return e; };
    // brightness a (0.02 to 2.4) to level: uniform in u = a up to 1, beyond which the core is opaque and only the halo
    // (0.18 a) brightens, so u grows more slowly there
    const U_MAX = 1 + 0.36 * 1.4, uOf = (a) => (a <= 1 ? a : 1 + 0.36 * (a - 1)), aOf = (u) => (u <= 1 ? u : 1 + (u - 1) / 0.36);
    const level = (b, n = NB) => aOf((b + 0.5) * U_MAX / n);
    const halo = [], core = [];
    for (let b = 0; b < NB; b++) halo.push(mkPath({ fill: 'none', stroke: '#8cb8ff', 'stroke-width': 30, 'stroke-opacity': Math.min(0.6, 0.18 * level(b)).toFixed(3), 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }));
    for (let b = 0; b < NB; b++) core.push(mkPath({ fill: 'none', stroke: '#bed7ff', 'stroke-width': 10, 'stroke-opacity': Math.min(1, level(b)).toFixed(3), 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }));
    const elines = mkPath({ fill: 'none', stroke: '#c9d8f5', 'stroke-width': 8, 'stroke-linecap': 'round' });
    // (round 8) the flows' arrows (see ARROW), in a group of their own over the field lines (they are the gas's option, not
    // the lines'), each flow in a light tint of its material's colour: the wind's, the accretion's, the envelope's, the
    // jet's and the rotation's (the disk's); NBM levels of opacity each
    const marksG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    fieldG.after(marksG);
    marksG.setAttribute('transform', 'scale(0.1)');
    const mkMarks = (stroke) => Array.from({ length: NBM }, (_, b) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      for (const [k, v] of [['fill', 'none'], ['stroke', stroke], ['stroke-width', 11], ['stroke-opacity', Math.min(1, level(b, NBM)).toFixed(3)], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) e.setAttribute(k, v);
      marksG.appendChild(e); return e;
    });
    const dots = mkMarks('#c4f5ff'), adots = mkMarks('#ffc27a'), edots = mkMarks('#e6d2fb'), jdots = mkMarks('#ffb8ae'), kdots = mkMarks('#bccbff');
    // (lvStep > 1, for measurements only: every lvStep-th level, as before the levels were made finer; see diskFrameStats)
    let lvStep = 1;
    const bucket = (a, n = NB) => {
      const b = Math.min(n - 1, Math.floor(uOf(a) / U_MAX * n)), k = n === NB ? lvStep : Math.max(1, lvStep >> 1);
      return k > 1 ? Math.min(n - 1, Math.floor(b / k) * k + (k >> 1)) : b;
    };
    // set a path's data only when it changed (most levels are empty in most frames)
    const setD = (e, d) => { if (e._d !== d) { e._d = d; e.setAttribute('d', d); } };
    // transmission of the pebble sheet between the camera and P (the same sheet as in the volume, without
    // its turbulent modulation); 1 when the segment does not cross the midplane
    // The magnetosphere's field lines (close up, with the field lines; see MAG): the star's closed dipole lines, L =
    // MAG_LINES and the last one, MAG.RT, which meets the disk's inner edge (brighter), 8 around in the star's frame (they
    // turn with it); and the disk's open lines just outside the edge, feet from MAG.RT to 0.13 au (the wind's solution,
    // as for the other lines, up to 0.25 au from the axis). Closed and open lines part at the disk's inner edge. Hidden
    // behind the star and, below the disk, behind its dust (sheetT).
    // (in tenths of a pixel as integers, as the field lines: the group is scaled by 0.1, the stroke widths ten times
    // their size in pixels; the X-point's label beside it, at its size)
    const magG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    fieldG.after(magG);
    magG.setAttribute('transform', 'scale(0.1)');
    const magPath = (w, op) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      for (const [k, v] of [['fill', 'none'], ['stroke', 'rgb(225,235,255)'], ['stroke-width', 10 * w], ['stroke-opacity', op], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) e.setAttribute(k, v);
      magG.appendChild(e); return e;
    };
    const magClosed = magPath(1, 0.5), magEdge = magPath(1.3, 0.8), magOpen = magPath(1, 0.45), magCurt = magPath(1.2, 0.85), magX = magPath(1.6, 0.95);
    magCurt.setAttribute('stroke', 'rgb(255,120,150)');
    magX.setAttribute('stroke', 'rgb(255,236,170)');
    const magXL = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const XPOINT_LABEL = false;   // (Disk Lab v2: the X-point is marked but not named, in the view and on the cut face)
    // (Disk Lab v2, round 7: nor marked: the small cross at the X-point goes too, in the view and on the cut face, as the
    // owner asked, "x のラベルが消えてない。消しといて"; the X-point stays where the closed and open lines part)
    const XPOINT_MARK = false;
    for (const [k, v] of [['font-size', 11], ['fill', 'rgba(255,236,170,0.95)'], ['text-anchor', 'middle']]) magXL.setAttribute(k, v);
    magG.after(magXL);
    const MAG_LINES = [0.022, 0.032, 0.044], MAG_FEET = [0.066, 0.08, 0.1, 0.13];
    let magOpenS = null, magOpen0 = [];   // the open lines' shapes, for the asymmetry magOpenS (see drawMag)
    // the closed loops' shapes in the dipole's frame (r = L sin^2 theta from the star's surface to the other side): per
    // line, the parts across the axis (st) and along it (ct) at MAG_NP points; each frame only turns them with the dipole
    const MAG_NP = 25, magLoops = [...MAG_LINES, MAG.RT].map((L) => {
      const th0 = Math.asin(Math.sqrt(MAG.RS / L)), st = [], ct = [];
      for (let j = 0; j < MAG_NP; j++) { const th = th0 + (Math.PI - 2 * th0) * j / (MAG_NP - 1), r = L * Math.sin(th) * Math.sin(th); st.push(r * Math.sin(th)); ct.push(r * Math.cos(th)); }
      return { L, st, ct };
    });
    // the curtains' middle line, L = MAG.RT (1 + MAG.DL / 2), from the disk to the star, in the dipole's frame likewise
    // (north and south: the part along the axis changes its sign)
    const magCurtL = MAG.RT * (1 + 0.5 * MAG.DL), magCurtTh = Math.asin(Math.sqrt(MAG.RS / magCurtL)), magCurtSt = [], magCurtCt = [];
    for (let j = 0; j <= 24; j++) {
      const th = Math.PI / 2 - (Math.PI / 2 - magCurtTh) * j / 24, sn = Math.sin(th), r = magCurtL * sn * sn;
      magCurtSt.push(r * sn); magCurtCt.push(r * Math.cos(th));
    }
    // the points of a line in a buffer used again for every line (x, y, z), and a point for the tests of visibility, so
    // that drawing allocates nothing per point
    const magBuf = new Float64Array(3 * 128), magP = [0, 0, 0];
    // behind the star: the segment from the camera to P passes within MAG.RS of its centre
    const behindStar = (P) => {
      const dx = P[0] - cam[0], dy = P[1] - cam[1], dz = P[2] - cam[2], dd = dx * dx + dy * dy + dz * dz;
      const t = -(cam[0] * dx + cam[1] * dy + cam[2] * dz) / dd;
      if (t <= 0 || t >= 1) return false;
      const x = cam[0] + t * dx, y = cam[1] + t * dy, z = cam[2] + t * dz;
      return x * x + y * y + z * z < MAG.RS * MAG.RS;
    };
    function drawMag() {
      const a = magFrame.vis * fieldAmp * modelAmp;
      const vis = (P) => kept(P) && !behindStar(P) && sheetT(P) > 0.5;
      const dX = drawMagX(magFrame.vis * modelAmp, vis);   // the name follows annotations, also with the field off
      if (a <= 0.01) { for (const e of [magClosed, magEdge, magOpen, magCurt, magX]) if (e.getAttribute('d')) e.setAttribute('d', ''); return; }
      const { ax: m, e1 } = magFrame, e2 = [m[1] * e1[2] - m[2] * e1[1], m[2] * e1[0] - m[0] * e1[2], m[0] * e1[1] - m[1] * e1[0]];
      // a polyline through the n points in magBuf (projected as project does), broken where hidden, behind the camera or
      // far off the picture (beyond twice its size on any side: close up, points beside the camera are thrown far off)
      const br = basis.r, bu = basis.u, bf = basis.f, kx = 1 / (basis.th * (W / Hh)), ky = 1 / basis.th;
      const poly = (n) => {
        let d = '', pen = false;
        for (let i = 0; i < 3 * n; i += 3) {
          const vx = magBuf[i] - cam[0], vy = magBuf[i + 1] - cam[1], vz = magBuf[i + 2] - cam[2], qz = vx * bf[0] + vy * bf[1] + vz * bf[2];
          if (qz <= zN) { pen = false; continue; }
          const qx = ((vx * br[0] + vy * br[1] + vz * br[2]) * kx / qz + 1) / 2 * W, qy = (1 - (vx * bu[0] + vy * bu[1] + vz * bu[2]) * ky / qz) / 2 * Hh;
          if (qx < -2 * W || qx > 3 * W || qy < -2 * Hh || qy > 3 * Hh) { pen = false; continue; }
          magP[0] = magBuf[i]; magP[1] = magBuf[i + 1]; magP[2] = magBuf[i + 2];
          if (!vis(magP)) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + Math.round(qx * 10) + ' ' + Math.round(qy * 10); pen = true;
        }
        return d;
      };
      let dC = '', dE = '';
      for (const { L, st, ct } of magLoops) {
        for (let k = 0; k < 8; k++) {
          const ph = (k + 0.5) * Math.PI / 4, cp = Math.cos(ph), sp = Math.sin(ph);
          const u0 = cp * e1[0] + sp * e2[0], u1 = cp * e1[1] + sp * e2[1], u2 = cp * e1[2] + sp * e2[2];
          for (let j = 0; j < MAG_NP; j++) { magBuf[3 * j] = st[j] * u0 + ct[j] * m[0]; magBuf[3 * j + 1] = st[j] * u1 + ct[j] * m[1]; magBuf[3 * j + 2] = st[j] * u2 + ct[j] * m[2]; }
          if (L === MAG.RT) dE += poly(MAG_NP); else dC += poly(MAG_NP);
        }
      }
      let dO = '';
      const sNow = linesS || 0;
      // (the open lines' shape, the solution's R and turning at each height, depends on the asymmetry only: made once for it)
      if (magOpenS !== sNow) {
        magOpenS = sNow; magOpen0 = [];
        MAG_FEET.forEach((Rf, i) => {
          for (const side of [1, -1]) {
            const s = side * sNow, zb = zBase(Rf), r0 = r0Of(Rf, s), shape = [];
            for (const h of [...diskHeights(Rf, s), ...chiS(bpOf(Rf)).map((chi) => zb + r0 * chi)]) {
              const [R, dphi] = fieldRP(Rf, h, s);
              if (R > 0.25 || h > 0.25 || shape.length >= 128) break;
              shape.push([R * Math.cos(dphi), R * Math.sin(dphi), side * h]);   // (turned by the angle sum each frame)
            }
            magOpen0.push({ i, Om: Omega(r0), shape });
          }
        });
      }
      for (const o of magOpen0) {
        const rot = 1.7 * o.i + o.Om * time, n = o.shape.length;
        for (let k = 0; k < 6; k++) {
          const c = Math.cos(rot + k * Math.PI / 3), sn = Math.sin(rot + k * Math.PI / 3);
          for (let j = 0; j < n; j++) { const q = o.shape[j]; magBuf[3 * j] = c * q[0] - sn * q[1]; magBuf[3 * j + 1] = sn * q[0] + c * q[1]; magBuf[3 * j + 2] = q[2]; }
          dO += poly(n);
        }
      }
      // the curtains: the middle line of their bundle, L = MAG.RT (1 + MAG.DL / 2), at the azimuths where they are dense
      // (as magAz on the GPU), from the disk to the star, north on the side the dipole tilts to and south on the other
      let dK = '';
      for (const north of [1, -1]) for (let k = -4; k <= 4; k++) {
        const dph = k * Math.PI / 9, ph = (north > 0 ? 0 : Math.PI) + dph, cp = Math.cos(ph), sp = Math.sin(ph);
        if (Math.pow(0.5 + 0.5 * Math.cos(dph), 3) < 0.15) continue;
        const u0 = cp * e1[0] + sp * e2[0], u1 = cp * e1[1] + sp * e2[1], u2 = cp * e1[2] + sp * e2[2];
        for (let j = 0; j <= 24; j++) {
          const st = magCurtSt[j], ct = north * magCurtCt[j];
          magBuf[3 * j] = st * u0 + ct * m[0]; magBuf[3 * j + 1] = st * u1 + ct * m[1]; magBuf[3 * j + 2] = st * u2 + ct * m[2];
        }
        dK += poly(25);
      }
      magClosed.setAttribute('d', dC); magEdge.setAttribute('d', dE); magOpen.setAttribute('d', dO); magCurt.setAttribute('d', dK); magX.setAttribute('d', dX);
      magG.setAttribute('opacity', a.toFixed(3));
    }
    function drawMagX(a, vis) {
      if (a <= 0.01 || !XPOINT_MARK) { magXL.textContent = ''; return ''; }
      // the X-point: where the star's last closed line (L = MAG.RT) meets the disk's open lines, on the ring at the
      // truncation radius; marked where the ring shows at the sides of the star (across the line of sight). (Disk Lab v2:
      // without its label, as the client asked; the label's placement is kept for its return)
      let dX = '', lx = null, lxFits = false;
      const azC = Math.atan2(cam[1], cam[0]), xlw = ja() ? 26 : 44;   // (the label's width, px)
      for (const sgn of [1, -1]) {
        const ph = azC + sgn * Math.PI / 2, P = [MAG.RT * Math.cos(ph), MAG.RT * Math.sin(ph), 0], q = project(P);
        if (q[2] <= zN || !vis(P)) continue;
        const x10 = Math.round(10 * q[0]), y10 = Math.round(10 * q[1]);
        dX += 'M' + (x10 - 50) + ' ' + (y10 - 50) + 'L' + (x10 + 50) + ' ' + (y10 + 50) + 'M' + (x10 - 50) + ' ' + (y10 + 50) + 'L' + (x10 + 50) + ' ' + (y10 - 50);
        const fits = q[0] - xlw / 2 > 4 && q[0] + xlw / 2 < W - 4 && q[1] - 9 > 14 && q[1] - 9 < Hh - 30;
        if (!lx || (fits && !lxFits) || (fits === lxFits && q[0] > lx[0])) { lx = q; lxFits = fits; }
      }
      if (XPOINT_LABEL && lx && annAmp > 0.01 && lx[0] > -xlw && lx[0] < W + xlw && lx[1] > 0 && lx[1] < Hh + 20) {
        magXL.setAttribute('x', Math.min(W - 4 - xlw / 2, Math.max(4 + xlw / 2, lx[0])).toFixed(1));
        magXL.setAttribute('y', Math.min(Hh - 30, Math.max(14, lx[1] - 9)).toFixed(1));
        magXL.textContent = ja() ? 'X 点' : 'X-point';
      } else magXL.textContent = '';
      magXL.setAttribute('opacity', (annAmp * a).toFixed(3));
      return dX;
    }
    function sheetT(P) {
      if ((cam[2] > 0) === (P[2] > 0)) return 1;
      const t = cam[2] / (cam[2] - P[2]);
      const cx = cam[0] + (P[0] - cam[0]) * t, cy = cam[1] + (P[1] - cam[1]) * t, Rc = Math.sqrt(cx * cx + cy * cy);
      if (Rc < MODEL.R_IN || Rc > RB_JS) return 1;
      const dx = P[0] - cam[0], dy = P[1] - cam[1], dz = P[2] - cam[2], mu = Math.abs(dz) / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ice = 1 - ss(MODEL.TICE - 6, MODEL.TICE + 6, tMidJS(Rc, lumNow));
      const kp = compAmp[2] * compAmp[2] * (3 - 2 * compAmp[2]);   // (round 7: with the pebbles off, they hide nothing)
      return Math.exp(-kp * MODEL.K_D * MODEL.SD0 * SigmaJS(Rc) * pebEdge(Rc) * pebbleAll(Rc) * (0.5 + 0.5 * ice) / Math.max(mu, 0.03));
    }
    // the starlight scattered toward the observer at P (relative to 90 degrees), behind the sheet or not (written
    // without Math.hypot, which is slow, as these run for every sample of every line in every frame)
    function seen(P) {
      const vx = cam[0] - P[0], vy = cam[1] - P[1], vz = cam[2] - P[2];
      const mu = (P[0] * vx + P[1] * vy + P[2] * vz) / ((Math.sqrt(P[0] * P[0] + P[1] * P[1] + P[2] * P[2]) || 1e-3) * Math.sqrt(vx * vx + vy * vy + vz * vz));
      return phaseWind(mu) * sheetT(P);
    }
    const fx = (v) => Math.round(v * 10);
    const TRACE_T = 0.3;   // (the arrows' moment: where the gas was TRACE_T earlier gives their direction and speed)
    // (Disk Lab v2, round 8, the owner: "the flow markers: an option of the gas; small arrows") The marks of the flows are
    // small arrows, one kind for every flow: each shows the gas's velocity where it is, apart from its rotation (in the
    // meridional plane: the wind's along its line, the accretion's inward, the envelope's fall, the jet's along the axis),
    // and a few on the midplane show the rotation itself (Keplerian; see drawFlow). An arrow's length on the screen grows
    // with the logarithm of the speed, ARROW.L1 px at 1 km/s and ARROW.DEC more for each factor of ten (6 px at 1 km/s, 11
    // at 10, 16 at 100; from ARROW.MIN to ARROW.MAX), times the foreshortening of the motion seen at that angle (an arrow
    // toward the viewer shortens). They move with the gas, as the dashes before them did (round 5), and are centred on it.
    const ARROW = { L1: 6, DEC: 5, MIN: 3, MAX: 18, HEAD: 3.5 };
    const KMS = 1.496e8 / (365.25 * 86400 / 12);   // km/s per au per unit of the model's time (a month: one orbit a year at 1 au)
    const arrowLen = (v) => Math.min(ARROW.MAX, Math.max(ARROW.MIN, ARROW.L1 + ARROW.DEC * Math.log10(Math.max(v, 1e-3))));
    // an arrow at q, the screen position of P, pointing from qb (that of B, where the gas was a moment before) to q, at
    // brightness a, for the speed v (km/s); added to the paths d (by level)
    function arrow(d, q, qb, P, B, v, a) {
      if (a <= 0.02 || qb[2] <= zN) return;
      const dx = q[0] - qb[0], dy = q[1] - qb[1], ls = Math.sqrt(dx * dx + dy * dy);
      const wx = P[0] - B[0], wy = P[1] - B[1], wz = P[2] - B[2], dw = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (ls < 1e-6 || dw < 1e-9) return;
      const L = arrowLen(v) * Math.min(1, ls * 2 * q[2] * basis.th / (Hh * dw));   // (px per au at that depth: Hh / (2 z tan))
      if (L < 2) return;
      const ux = dx / ls, uy = dy / ls, hx = q[0] + 0.5 * L * ux, hy = q[1] + 0.5 * L * uy, hb = Math.min(ARROW.HEAD, 0.45 * L), hw = 0.65 * hb;
      const head = 'L' + fx(hx) + ' ' + fx(hy);
      d[bucket(a, NBM)] += 'M' + fx(q[0] - 0.5 * L * ux) + ' ' + fx(q[1] - 0.5 * L * uy) + head
        + 'M' + fx(hx - hb * ux - hw * uy) + ' ' + fx(hy - hb * uy + hw * ux) + head + 'L' + fx(hx - hb * ux + hw * uy) + ' ' + fx(hy - hb * uy - hw * ux);
    }
    let fieldPts = [];   // the field lines' visible samples on the screen this frame (x, y pairs), which the snow line's label avoids
    function drawField() {
      fieldPts = [];
      if (fieldAmp <= 0) { for (const e of [...halo, ...core]) setD(e, ''); return; }
      const gain = Number(box.dataset.field || 0.5) * (opt.slice ? 0.6 : 1);   // quieter behind a slice
      const dL = new Array(NB).fill(''), dD = new Array(NBM).fill('');
      const asymS = asymAmp * asymAmp * (3 - 2 * asymAmp);
      shapeLines(Math.round(ASYM_F_JS * asymS * 100) / 100);
      // (close to the star every other line: they are far and many there, and the magnetosphere's lines are the subject)
      const thin = Math.hypot(cam[0], cam[1], cam[2]) < 0.5 ? 2 : 1;
      for (let li = 0; li < lines.length; li += thin) {
        const L = lines[li];
        const kL = L.k(asymS);
        if (kL <= 0.004) continue;
        const rot = L.phi0 + Omega(L.r0) * time, n0 = L.pts.length, cr = Math.cos(rot), sr = Math.sin(rot);
        // projected samples (null behind the camera, or far off the picture: beyond twice its size on any side) and their
        // brightness; a sample closer on the screen than 1.5 px to the last one kept is skipped (the spline goes through
        // the others: far away most of a line's samples are)
        const Q = [], A = [];
        let qk = null;
        for (let j = 0; j < n0; j++) {
          const s = L.pts[j], c = cr * s.c - sr * s.s, sn = sr * s.c + cr * s.s;   // (cos and sin of rot + s.dphi)
          const P = [s.R * c, s.R * sn, s.z], q = project(P);
          if (q[2] > zN && q[0] > -2 * W && q[0] < 3 * W && q[1] > -2 * Hh && q[1] < 3 * Hh && kept(P)) {
            if (qk && j < n0 - 1 && (q[0] - qk[0]) * (q[0] - qk[0]) + (q[1] - qk[1]) * (q[1] - qk[1]) < 2.25) continue;
            const a = s.b * kL * gain * seen(P) * (1 - faceAlpha(P));
            Q.push(q); A.push(a); qk = q;
            if (a > 0.04) fieldPts.push(q[0], q[1]);
          } else if (qk !== null || !Q.length || Q[Q.length - 1] !== null) { Q.push(null); A.push(0); qk = null; }
        }
        const n = Q.length;
        // centripetal Catmull-Rom tangents (knots spaced by the square root of the chord), cubic Beziers
        const T = new Array(n).fill(0);
        for (let i = 1; i < n; i++) { const dx = Q[i] && Q[i - 1] ? Q[i][0] - Q[i - 1][0] : 0, dy = Q[i] && Q[i - 1] ? Q[i][1] - Q[i - 1][1] : 0; T[i] = T[i - 1] + (Q[i] && Q[i - 1] ? Math.sqrt(Math.sqrt(dx * dx + dy * dy)) + 1e-6 : 1); }
        const tangent = (i) => { const ia = Q[i - 1] ? i - 1 : i, ib = Q[i + 1] ? i + 1 : i, dt = T[ib] - T[ia] || 1; return [(Q[ib][0] - Q[ia][0]) / dt, (Q[ib][1] - Q[ia][1]) / dt]; };
        let lastB = -1;
        for (let i = 0; i + 1 < n; i++) {
          if (!Q[i] || !Q[i + 1]) { lastB = -1; continue; }
          const am = 0.5 * (A[i] + A[i + 1]);
          if (am <= 0.02) { lastB = -1; continue; }
          const b = bucket(am), m0 = tangent(i), m1 = tangent(i + 1), dt = (T[i + 1] - T[i]) / 3;
          const seg = 'C' + fx(Q[i][0] + m0[0] * dt) + ' ' + fx(Q[i][1] + m0[1] * dt) + ' ' + fx(Q[i + 1][0] - m1[0] * dt) + ' ' + fx(Q[i + 1][1] - m1[1] * dt) + ' ' + fx(Q[i + 1][0]) + ' ' + fx(Q[i + 1][1]);
          dL[b] += (b === lastB ? '' : 'M' + fx(Q[i][0]) + ' ' + fx(Q[i][1])) + seg;
          lastB = b;
        }
      }
      for (let b = 0; b < NB; b++) { setD(halo[b], dL[b]); setD(core[b], dL[b]); }
    }

    // (round 8) the arrows of the wind, the rotation and the jet (with the gas and the flow arrows on: marksAmp; in the
    // model's look)
    const KEP = Array.from({ length: 24 }, (_, i) => { const [u1, u2] = sobol2(i + 151); return { R: 0.3 * Math.pow(25 / 0.3, u1), phi0: 2 * Math.PI * u2 }; });
    const JET_GAP = 70;   // px between the jet's arrows on the screen
    function drawFlow() {
      const dW = new Array(NBM).fill(''), dK = new Array(NBM).fill(''), dJ = new Array(NBM).fill('');
      const asymS = asymAmp * asymAmp * (3 - 2 * asymAmp), gainM = 0.5 * (opt.slice ? 0.6 : 1) * modelAmp * marksAmp;
      const gW = gainM * compAmp[3];
      if (gW > 0.004) {
        shapeLines(Math.round(ASYM_F_JS * asymS * 100) / 100);
        for (const p of parcels) {
          // parcels released at a steady rate, each moving with the flow of the solution: dense where the gas is slow near
          // the base, spread out as it accelerates; the arrow from where it was TRACE_T earlier along its line, in the same
          // meridional plane (its rotation apart)
          const kP = p.k(asymS) * gW;
          if (kP <= 0.004) continue;
          // (what does not change with time, for the asymmetry's share of the moment: kept with the parcel)
          if (p.cs !== linesS) {
            const sP_ = p.side * linesS, zb = zBase(p.Rf), r0 = r0Of(p.Rf, sP_), T = bpOf(p.Rf), chiEnd = Math.min(Math.max((ZTOP - zb) / r0, 0.5), BP.CHIMAX);
            p.cs = linesS; p.c = { sP_, zb, r0, Om: Omega(r0), T, chiEnd, tEnd: tabF(T.TAU, tabS(chiEnd)) };
          }
          const { sP_, zb, r0, Om, T, tEnd } = p.c;
          const ph = ((p.u + time * Om / tEnd) % 1 + 1) % 1;
          const chi = chiOfTau(ph * tEnd, T), h = zb + r0 * chi;
          const [R, dphi] = fieldRP(p.Rf, h, sP_), phi = p.phi0 + Om * time + dphi, c = Math.cos(phi), sn = Math.sin(phi);
          const P = [R * c, R * sn, p.side * h], q = project(P);
          if (q[2] <= zN || !kept(P)) continue;
          const a = ss(0, 0.03, ph) * (1 - ss(0.6, 1, ph)) * Math.exp(-(h - zb) / (2 * r0 + 2.5)) * (1 - ss(0.6, 1, chi / BP.CHIMAX)) * kP * starlight(R, h) * seen(P) * (1 - faceAlpha(P));
          if (a <= 0.02) continue;
          const cb = chiOfTau(Math.max(0, ph - TRACE_T * Om / tEnd) * tEnd, T), hb = zb + r0 * cb, Rb = fieldRP(p.Rf, hb, sP_)[0];
          const B = [Rb * c, Rb * sn, p.side * hb], dl = Math.hypot(R - Rb, h - hb);
          arrow(dW, q, project(B), P, B, dl / TRACE_T * KMS, 1.6 * a);
        }
      }
      // the rotation: KEP arrows on the midplane (on its side toward the camera), from 0.3 to 25 au, turning with the disk at
      // v_K; faded where they would crowd close to the star on the screen
      const gK = 0.55 * gainM * compAmp[0];
      if (gK > 0.004) {
        const q0 = project([0, 0, 0]);
        for (const k of KEP) {
          const phi = k.phi0 + Omega(k.R) * time, zc = cam[2] >= 0 ? 1e-6 : -1e-6;
          const P = [k.R * Math.cos(phi), k.R * Math.sin(phi), zc], q = project(P);
          if (q[2] <= zN || !kept(P) || !inView(q)) continue;
          const a = gK * ss(30, 70, Math.hypot(q[0] - q0[0], q[1] - q0[1])) * (1 - ss(0.8 * MODEL.R_OUT, MODEL.R_OUT, k.R)) * (1 - faceAlpha(P));
          if (a <= 0.02) continue;
          const B = [k.R * Math.cos(phi - 0.02), k.R * Math.sin(phi - 0.02), zc];
          arrow(dK, q, project(B), P, B, vK(k.R), a);
        }
      }
      // the jet: arrows along the axis on each side, moving out at its speed, JET_GAP px apart on the screen where the star
      // is: s au apart, a power of two, the arrows of the next power (every other one) taking over as the scale changes
      const gJ = 1.2 * gainM * jetAmp * jetAmp * (3 - 2 * jetAmp);
      const zS = project([0, 0, 0])[2];
      if (gJ > 0.004 && zS > zN) {
        const lv = Math.log2(JET_GAP * 2 * zS * basis.th / Hh), n = Math.floor(lv), w = lv - n, sp = Math.pow(2, n);
        for (const side of [1, -1]) {
          const v = JET.V * (side > 0 ? 1 : 1 - (1 - 1 / JET.LOW) * asymSm()), tv = (time % 3600) * v / sp, m = Math.floor(tv), f = tv - m;
          for (let k = 0; k < 16; k++) {
            const z = sp * (k + f);
            if (z > 0.85 * JET.ZMAX) break;
            const P = [0, 0, side * z], q = project(P);
            if (q[2] <= zN || !kept(P) || !inView(q)) continue;
            const a = gJ * ((k + m) % 2 === 0 ? 1 : 1 - w) * ss(0.3, 1, z / sp) * ss(2 * JET.Z0, 6 * JET.Z0, z) * sheetT(P) * (1 - faceAlpha(P));
            if (a <= 0.02) continue;
            const B = [0, 0, side * (z - v * TRACE_T)];
            arrow(dJ, q, project(B), P, B, v * KMS, a);
          }
        }
      }
      for (let b = 0; b < NBM; b++) { setD(dots[b], dW[b]); setD(kdots[b], dK[b]); setD(jdots[b], dJ[b]); }
    }

    function drawAcc() {
      const dD = new Array(NBM).fill(''), w = accW(), k = accK(), gainA = 0.9 * modelAmp * compAmp[0] * marksAmp * (opt.slice ? 0.6 : 1);
      if (gainA > 0.02) for (const m of accMarks) {
        const ws = m.side > 0 ? w[0] : w[1], ks = m.side > 0 ? k[0] : k[1];
        if (ws <= 0.01) continue;
        const c = 1.25 * ks * MODEL.H0 * 0.5236, e0 = Math.pow(m.R0, 1.25), e1 = Math.pow(ACC.R_END, 1.25), T = (e0 - e1) / c;
        const ph = ((time / T + m.u) % 1 + 1) % 1;
        const at = (t) => {
          const R = Math.pow(Math.max(e0 - c * t, e1), 0.8), phi = m.phi0 + 4 * (Math.pow(R, -0.25) - Math.pow(m.R0, -0.25)) / (ks * MODEL.H0);
          return [R * Math.cos(phi), R * Math.sin(phi), m.side * (m.side > 0 ? zAccHJS(R) : zAccLowJS(R, asymSm())) * Hof(R)];
        };
        const t = ph * T, P = at(t), q = project(P);
        if (q[2] <= zN || !kept(P)) continue;
        const a = ws * gainA * ss(0, 0.04, ph) * (1 - ss(0.85, 1, ph)) * accAmpJS(Math.hypot(P[0], P[1])) * sheetT(P) * (1 - faceAlpha(P));
        if (a <= 0.02) continue;
        // (round 8: an arrow from where it was TRACE_T earlier, at its present azimuth: the inflow, its rotation apart)
        const Bf = at(Math.max(0, t - TRACE_T)), R = Math.hypot(P[0], P[1]), Rb = Math.hypot(Bf[0], Bf[1]);
        const B = [P[0] * Rb / R, P[1] * Rb / R, Bf[2]];
        arrow(dD, q, project(B), P, B, Math.hypot(Rb - R, Bf[2] - P[2]) / Math.max(1e-6, t - Math.max(0, t - TRACE_T)) * KMS, 1.2 * a);
      }
      for (let b = 0; b < NBM; b++) setD(adots[b], dD[b]);
    }

    // the envelope's particles: brightness as for the wind's (scattered starlight with a softened falloff, here
    // about 20 au as in the volume; in the disk's shadow near the midplane), faded in at the start and out at the end
    const envPoint = (L, r, th, ph) => [r * Math.sin(th) * Math.cos(L.phi0 + ph), r * Math.sin(th) * Math.sin(L.phi0 + ph), L.side * r * Math.cos(th)];
    function drawEnv() {
      const dD = new Array(NBM).fill('');
      let dl = '';
      const envOn = envVis * modelAmp > 0.02;
      if (envOn) for (const L of envLines) {
        let pen = false;
        for (const [r, th, ph] of L.line) {
          const P = envPoint(L, r, th, ph), q = project(P);
          if (q[2] <= zN || !kept(P)) { pen = false; continue; }
          dl += (pen ? 'L' : 'M') + fx(q[0]) + ' ' + fx(q[1]); pen = true;
        }
      }
      elines.setAttribute('d', dl); elines.setAttribute('stroke-opacity', (0.18 * envVis * modelAmp).toFixed(3));
      if (envOn) for (const L of envLines) for (let m = 0; m < 3; m++) {
        const u = ((m / 3 + 0.37 * L.phi0 + time * ENV.SPEED / L.T) % 1 + 1) % 1;
        // the point at phase v along the streamline (sampled evenly in time)
        const pointAt = (v) => {
          const f = Math.max(0, v) * (L.pts.length - 1), k = Math.min(L.pts.length - 2, Math.floor(f)), w = f - k, a0 = L.pts[k], a1 = L.pts[k + 1];
          return envPoint(L, a0[0] + (a1[0] - a0[0]) * w, a0[1] + (a1[1] - a0[1]) * w, a0[2] + (a1[2] - a0[2]) * w);
        };
        const P = pointAt(u), q = project(P), r = Math.sqrt(P[0] * P[0] + P[1] * P[1] + P[2] * P[2]);
        if (q[2] <= zN || !kept(P)) continue;
        const a = envVis * modelAmp * marksAmp * ss(0, 0.08, u) * (1 - ss(0.85, 1, u)) * ss(0.13, 0.2, Math.abs(P[2]) / Math.hypot(P[0], P[1])) * 1.4 / Math.sqrt(1 + r * r / 12600) * seen(P);
        if (a <= 0.02) continue;
        // (round 8: an arrow from where it was a moment before, at its present azimuth: its fall, the rotation apart; the
        // particles move ENV.SPEED times faster than the clock, the speed is the gas's own)
        const du = TRACE_T * ENV.SPEED / L.T, Bf = pointAt(u - du), R = Math.hypot(P[0], P[1]), Rb = Math.hypot(Bf[0], Bf[1]);
        const B = [P[0] * Rb / R, P[1] * Rb / R, Bf[2]];
        arrow(dD, q, project(B), P, B, Math.hypot(Rb - R, Bf[2] - P[2]) / (TRACE_T * ENV.SPEED) * KMS, 0.8 * a);
      }
      for (let b = 0; b < NBM; b++) setD(edots[b], dD[b]);
    }

    // (round 7: the snow line follows from the temperature, see snowR; data-snow, its radius until round 6, is not read)
    const opt = {
      el: Number(box.dataset.elevation || 32) * Math.PI / 180,
      az: Number(box.dataset.azimuth || -70) * Math.PI / 180,
      dist: Number(box.dataset.distance || 90),
      fov: Number(box.dataset.fov || 32) * Math.PI / 180,
      scale: Number(box.dataset.scale || 0.6),
      steps: Number(box.dataset.steps || 150),
      exposure: Number(box.dataset.exposure || 1.0),
      spin: Number(box.dataset.spin || 0.004),
      seed: Number(box.dataset.seed || 2.0),
      mode: Number(box.dataset.mode || 63),   // see uMode; 16: the planets, 32: the envelope
      // (Disk Lab v2) the planets: "a:on,a:on" (au; 1 or 0), default one at 3 au
      planets: (box.dataset.planets || '3:1').split(',').map((t) => t.split(':')),
      scaleMax: Number(box.dataset.scaleMax || 1),
      // the cutaway (see uCutA): open with data-slice, a quarter cut away with data-cut="quarter" (else half);
      // data-slice-q picks the quantity on the cut faces
      slice: 'slice' in box.dataset,
      cut: box.dataset.cut === 'quarter' ? 'quarter' : 'half',
      sliceQ: { T: 'T', rho: 'rho', layers: 'layers', none: 'rho', tau: 'T' }[box.dataset.sliceQ] || 'T',
      // the annotations laid over the picture (the snow line and its label, the scale bar, the planet's label, the
      // lines, labels and colour bar on the slice's face): data-annotations="off" starts without them
      ann: box.dataset.annotations !== 'off',
      // the look (see uLook): 'model', or as observed: 'optical', 'mir', 'mm', 'co' (the CO line)
      look: own(LOOKS, box.dataset.look) ? box.dataset.look : 'model',
      // the CO line's display (see uCoMode): 'chan' (a channel map at coV km/s), 'm1', 'm0'
      coMode: own(CO_MODES, box.dataset.coMode) ? box.dataset.coMode : 'chan',
      coV: Number(box.dataset.coV || 2),
      // multiple scattering, approximate (see MS_C): on unless data-ms="off"
      ms: box.dataset.ms !== 'off',
      // the wind's asymmetry (see uWindLow; the surface accretion follows it): on unless data-asym="off"
      asym: box.dataset.asym !== 'off',
      // the marks of the flows (round 8: small arrows of the wind, the accretion, the envelope, the jet and the rotation, and
      // the arrows on the cut faces; see ARROW): off unless data-marks="on"; drawn while the gas is shown
      marks: box.dataset.marks === 'on',
      // the waves' emphasis (the planet's wake exaggerated, see wake): off unless data-waves="on"
      waves: box.dataset.waves === 'on',
      // (round 8) the background (see BG): 'off', 'stars' (the default) or 'cloud', data-bg
      bg: own(BG.MODES, box.dataset.bg) ? box.dataset.bg : 'stars',
      // (round 8) the finish's level for the page's quality, 0 to 2 (see the note before JET): data-fx, 2 unless given
      fx: Math.max(0, Math.min(2, Math.round(Number(box.dataset.fx ?? 2)) || 0)),
      // (Disk Lab v2) a display factor for each of the first four components (gas, small grains, pebbles, wind): how much
      // of it is drawn, its glow and its absorption alike, 0.25 to 3 (1: the model's amount); a choice of the viewer
      gain: [1, 1, 1, 1]
    };
    const matLin = new Float32Array(MAT.flatMap(([, hex, k]) => linHex(hex).map((v) => v * k)));   // (round 8, see MAT)
    const clumps = Array.from({ length: 6 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0, crossed: true }));
    const vapor = Array.from({ length: 4 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0 }));
    let W = 0, Hh = 0, rW = 1, rH = 1, faceT = null, faceA = null, cam, basis, time = restoredTime, last = 0, running = false, dragging = false, touching = false, moved = false, px = 0, py = 0, azUser = opt.az, elUser = opt.el;
    let paused = false, speed = 1, dirty = true, benching = false, fieldMs = 0;
    const Omega = (R) => 0.5236 * Math.pow(R, -1.5);
    // --- the planets: each fades in and out over about 1.5 s when it is turned on or off (its amp); its gap's depth is
    // amp times the depth for the camera's distance to its orbit (DEPTH), and its wake's strength amp times the strength
    // for that distance (the observed looks take the near values of both); the waves' emphasis eases in and out
    // (wavesAmp) ---
    // (Disk Lab v2) the planets, each { a, on, phi0, amp (its fade), fade (s), d (its gap's depth now), dSet, wake, rim,
    // trap, light (its row of gapLight) }; the component (opt.mode & 16) shows those that are on. The one at 3 au, alone,
    // is drawn as the single planet was.
    const hillOf = (p) => p.a * Math.cbrt(p.q / 3);   // a planet's Hill radius (au)
    // (round 8: m, the mass in M_J, and q, the mass ratio, see MASS)
    const planetObj = (a, on, i, m = 1) => ({ a, on, m, q: qOfM(m), phi0: PLANETS.PHI0(i), amp: 0, fade: 1.5, d: 0, dSet: -1, wake: 0, rim: null, trap: trapOf(0, a, [], qOfM(m)), light: new Float32Array(128) });
    const planetsFrom = (list) => {
      const out = [];
      for (const it of list || []) {
        if (out.length >= PLANETS.MAX) break;
        const a = Array.isArray(it) ? Number(it[0]) : Number(it && it.a), on = Array.isArray(it) ? it[1] : it && it.on;
        const m0 = Number(Array.isArray(it) ? it[2] : it && it.m), m = isFinite(m0) && m0 > 0 ? Math.min(MASS.MAX, Math.max(MASS.MIN, +m0.toPrecision(3))) : 1;   // (round 8: a mass; none, as in links before, is Jupiter's)
        if (!isFinite(a)) continue;
        out.push([Math.min(PLANETS.RANGE[1], Math.max(PLANETS.RANGE[0], +a.toPrecision(3))), on == null ? true : !!Number(on), m]);
      }
      return out;
    };
    const planets = planetsFrom(opt.planets).map(([a, on, m], i) => planetObj(a, on, i, m));
    for (const p of planets) p.amp = (opt.mode & 16) && p.on ? 1 : 0;
    const plWant = (p) => ((opt.mode & 16) && p.on ? 1 : 0);
    const planetPhiOf = (p, t) => p.phi0 + Omega(p.a) * t;
    const planetPosOf = (p, t) => { const a = planetPhiOf(p, t); return [p.a * Math.cos(a), p.a * Math.sin(a), 0]; };
    let followI = 0;   // the planet followed (see follow)
    const followed = () => planets[Math.min(followI, planets.length - 1)] || null;
    const planetPhi = (t) => { const p = followed(); return p ? planetPhiOf(p, t) : 0; };
    const planetPos = (t) => { const p = followed(); return p ? planetPosOf(p, t) : [0, 0, 0]; };
    const anyPlanet = () => planets.reduce((m, p) => Math.max(m, p.amp), 0);
    let wavesAmp = opt.waves ? 1 : 0;
    // ln of the gaps at R, and the pebbles there relative to the smooth disk, with every planet's gap as it is now
    const gapLnAll = (R) => planets.reduce((s, p) => s + gapLnJS(R, p.d, p.a, p.q), 0);
    const pebbleAll = (R) => planets.reduce((f, p) => f * pebbleJS(R, p.d, p.a, p.trap, p.q), 1);
    const planetsKey = () => planets.map((p) => p.a + '/' + p.m + '/' + Math.round(p.d * 50)).join(',');
    // how near the camera is to a planet's orbit: 0 beyond D1, 1 within D0 (in units of a / 3 au: the distances were
    // chosen for the planet at 3 au)
    const nearOf = (c, a = PLANET.A) => { const k = a / PLANET.A; return 1 - ss(DEPTH.D0 * k, DEPTH.D1 * k, Math.hypot(Math.hypot(c[0], c[1]) - a, c[2])); };
    const wakeFor = (c, a) => DEPTH.WAKE_FAR + (1 - DEPTH.WAKE_FAR) * nearOf(c, a);
    // the inner rim of a gap: where z_s/R, the surface's angle seen from the star, peaks inside the gap; its shadow
    // ends where the outer wall climbs above that angle again (null when the gap is too shallow to cast one)
    function gapRim(d, a = PLANET.A, q = PLANET.Q) {
      const W = 1.1 * gapK(a, q).dR2, sA = (R) => Hof(R) * Math.sqrt(2 * Math.max(MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) + gapLnJS(R, d, a, q), 1)) / R;
      const dR = 0.0005 * a / PLANET.A;
      let R = Math.max(a - W, 0.5 * MODEL.R_IN), prev = sA(R);
      for (; R < a; R += dR) { const v = sA(R + dR); if (v < prev) break; prev = v; }
      if (R >= a) return null;
      const out = { R, th: prev, h: Hof(R) / R };
      for (R += dR; R < a + 1.5 * W && sA(R) < out.th; R += dR);
      out.end = R;
      return out;
    }
    const rims = () => planets.map((p) => p.rim).filter(Boolean);
    // --- easter eggs ---
    // An FU Orionis outburst (clicking the star): accretion onto the star surges for a while and its luminosity rises
    // thirtyfold in about 1.5 s, holds for 4 s and decays over some 30 s of the model clock (real outbursts last decades;
    // the luminosity of FU Ori objects rises a hundredfold or so). The midplane temperature follows L^1/4, so the snow
    // line moves out (round 7: with tempAt, to 4.4 au; as L^1/2 to 5 au before): the pebbles' ice sublimates inside it and freezes again as it comes
    // back (in V883 Ori, in outburst, ALMA found the snow line near 40 au; Cieza et al. 2016).
    // (Disk Lab v2: the outburst keeps its own clock, burst.age, real seconds times the speed, since the model's clock
    // slows as the view closes in: at the snow line's view it would have taken a quarter of an hour)
    let burst = null, rSn = snowR(1), lumNow = 1;
    const burstL = () => {
      if (!burst) return 1;
      const dt = burst.age;
      if (dt < 0 || dt > 60) { burst = null; return 1; }
      // (the decay tapered to nothing from 40 to 60 s, so that the exposure and the snow line do not step at its end)
      return 1 + 29 * ss(0, 1.5, dt) * (dt < 5.5 ? 1 : Math.exp(-(dt - 5.5) / 9)) * (1 - ss(40, 60, dt));
    };
    const snowNow = () => { const l = burstL(); if (l !== lumNow || !rSn) { lumNow = l; rSn = snowR(l); } };
    // a short explanation in the panel, faded in and out
    const toast = document.createElement('div');
    toast.className = 'disk-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = 'position:absolute;right:12px;top:12px;max-width:min(360px,calc(100% - 24px));padding:9px 12px;border-radius:6px;'
      + 'background:rgba(10,13,24,.82);color:#dfe8f5;font:12.5px/1.65 var(--sans,sans-serif);letter-spacing:.02em;pointer-events:none;opacity:0;transition:opacity .6s';
    box.appendChild(toast);
    // the hidden texts that describe the canvas (the picture, the keys)
    const hidden = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
    const uid = Math.random().toString(36).slice(2, 9), descEl = document.createElement('p'), keysEl = document.createElement('p');
    descEl.id = 'disk-desc-' + uid; keysEl.id = 'disk-keys-' + uid; descEl.className = keysEl.className = 'disk-sr';
    descEl.style.cssText = keysEl.style.cssText = hidden;
    box.append(descEl, keysEl);
    canvas.setAttribute('aria-describedby', descEl.id + ' ' + keysEl.id);
    const KEYS_JA = 'ドラッグで回転、Shift+ドラッグ(または中・右ボタン)で見る中心を動かす。タッチでは指 1 本で移動、2 本の指でピンチしてズーム、ひねって回転、そろえて上下に動かして傾き、ダブルタップで拡大、2 本指のタップで縮小。キー:矢印で回転、Shift+矢印で中心を動かす、＋と−でズーム(ホイールのズームはこの図にフォーカスしてから)、Home で元の視点と星の中心、C で中心を星に戻す(視点はそのまま)、スペースで一時停止、1〜5 で視点、P で惑星に寄る、F で磁力線、S で断面、A で注釈、B で星の増光、G で惑星を育てる。「タップで小石を置く」がオンのときは、円盤をクリックするとそこに小石の塊を置きます。';
    const KEYS_EN = 'Drag to turn, Shift+drag (or the middle or right button) to move the point looked at. On a touch screen one finger moves, two fingers pinch to zoom, twist to turn and move up or down together to tilt; a double tap zooms in, a two-finger tap zooms out. Keys: arrows turn, Shift+arrows move the point looked at, + and - zoom (the wheel zooms once this picture has the focus), Home returns to the first view centred on the star, C brings the point looked at back to the star (the view kept), space pauses, 1 to 5 pick views, P goes to the planet, F toggles the field lines, S the cut, A the annotations, B makes the star flare, G grows the planet. With \u201cTap to drop pebbles\u201d on (under Pebbles), a click on the disk drops a clump of pebbles there.';
    let toastTimer = 0, toastSwap = 0, toastMsg = null;   // toastMsg: the text showing, in both languages (and short ones)
    // the text for the panel: the short version on a narrow one, when there is one
    const toastText = () => { const n = W > 0 && W < 560, m = toastMsg; return ja() ? (n && m[2] ? m[2] : m[0]) : (n && m[3] ? m[3] : m[1]); };
    // shows a text for ms (jaS, enS: shorter versions for a narrow panel); one already showing fades out first (0.25 s),
    // so texts never swap abruptly
    const say = (ja_, en, ms, jaS, enS) => {
      clearTimeout(toastTimer); clearTimeout(toastSwap);
      const show = () => { toastMsg = [ja_, en, jaS, enS]; toast.textContent = toastText(); toast.style.transition = 'opacity .45s'; toast.style.opacity = '1'; toastFit(); toastTimer = setTimeout(hush, ms); };
      if (toast.style.opacity === '1') { toast.style.transition = 'opacity .25s'; toast.style.opacity = '0'; toastSwap = setTimeout(show, 260); } else show();
    };
    const hush = () => { clearTimeout(toastTimer); clearTimeout(toastSwap); toast.style.transition = 'opacity .6s'; toast.style.opacity = '0'; toast.style.pointerEvents = 'none'; toastTimer = setTimeout(toastFit, 600); };
    // on a narrow panel (a phone) the box is smaller and sits just below the panel, outside it (the panel clips what
    // overflows it, so the box is put beside it in the page, in the normal flow), so that it leaves the whole
    // picture free (the star, which an outburst's text covered); a tap on it puts it away (it takes taps only while it
    // shows, so that a faded one does not catch those meant for the page under it)
    const toastFit = () => {
      const n = W > 0 && W < 560, on = toast.style.opacity === '1';
      if (n && box.parentNode) {
        if (toast.parentNode !== box.parentNode) box.after(toast);
        Object.assign(toast.style, { position: 'relative', display: on ? 'block' : 'none', marginTop: '4px', top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', width: '100%', boxSizing: 'border-box', maxWidth: 'none', zIndex: '5', fontSize: '11.5px', lineHeight: '1.55', padding: '7px 10px', pointerEvents: on ? 'auto' : 'none' });
      } else {
        if (toast.parentNode !== box) box.appendChild(toast);
        Object.assign(toast.style, { position: 'absolute', display: 'block', marginTop: '0', top: '12px', bottom: 'auto', left: 'auto', right: '12px', width: '', boxSizing: '', maxWidth: 'min(360px,calc(100% - 24px))', zIndex: '', fontSize: '12.5px', lineHeight: '1.65', padding: '9px 12px', pointerEvents: 'none' });
      }
    };
    toast.addEventListener('click', hush);
    const startBurst = () => {
      if (reduce || (burst && burst.age < 8)) return;   // the clock does not run with reduced motion
      burst = { age: 0 };
      say('FU オリオン型の増光:星への降着が一時的に急増して、星が約 30 倍明るくなりました。円盤が温まってスノーラインが約 4 au まで外へ動き、小石の氷が昇華します。降着が収まると暗くなり、水は再び凍ります(実際の増光は数十年続きます。オリオン座 V883 では、増光中のスノーラインが約 40 au にあります)。',
        'An FU Orionis outburst: accretion onto the star surges and it brightens about thirtyfold. The disk warms, the snow line moves out to about 4 au and the pebbles\u2019 ice sublimates; as the accretion calms down the star dims and the water freezes again (real outbursts last decades; in V883 Ori the snow line lies near 40 au during the outburst).', 14000,
        'FU オリオン型の増光:星が約 30 倍明るくなり、スノーラインが約 4 au まで外へ動きます(降着が収まると元に戻ります)。',
        'An FU Orionis outburst: the star brightens about thirtyfold and the snow line moves out to about 4 au (it returns as the accretion calms down).');
    };
    // Growing a planet: three clumps of pebbles dropped near one radius (within a tenth of it, 0.3 au at 3 au) in 20 s of
    // the model clock, where a planet may be (within PLANETS.RANGE, no shown planet nearer than the mutual Hill rule in the
    // ratio of the radii, a place free among PLANETS.MAX), make a core there; it gathers gas, grows to Jupiter's mass and
    // opens its gap (the gap fades in over 8 s instead of 1.5). (Disk Lab v2: wherever the pebbles gather, alongside
    // the planets there are; it was at 3 au with the planet turned off.)
    let seeds = [];
    // (round 8: neighbours MASS.K_HILL mutual Hill radii apart, for a new planet of mass m; see MASS)
    const plRoom = (R, skip = -1, m = 1) => R >= PLANETS.RANGE[0] && R <= PLANETS.RANGE[1]
      && planets.every((p, i) => i === skip || !plWant(p) || Math.max(R, p.a) / Math.min(R, p.a) >= minRatio(m, p.m));
    const seedPlanet = (R) => {
      if (!plRoom(R)) return;
      seeds = seeds.filter((s) => time - s.t < 20 && Math.abs(s.R - R) < 0.1 * R).concat([{ t: time, R }]);
      if (seeds.length < 3) return;
      const Rc = Math.round(seeds.reduce((m, s) => m + s.R, 0) / seeds.length * 100) / 100;
      seeds = [];
      // (a place: one that is off, else a new one)
      let i = planets.findIndex((p) => !p.on || !(opt.mode & 16));
      if (!(opt.mode & 16)) { for (const p of planets) p.on = false; i = planets.length ? 0 : -1; }
      if (i < 0) { if (planets.length >= PLANETS.MAX) return; planets.push(planetObj(Rc, true, planets.length)); i = planets.length - 1; }
      // (round 8: it grows to Jupiter's mass, as the text says)
      Object.assign(planets[i], { a: Rc, on: true, m: 1, q: qOfM(1), amp: 0, fade: 8, dSet: -1 });
      // (round 9, the owner: "once a planet is made, clear the pebbles around it") the clumps within its feeding zone, CLEAR
      // Hill radii of its orbit (the zone from which a planet gathers solids reaches about 2 sqrt(3), 3.5 Hill radii, to each
      // side), wherever they have drifted to, fade out over CLEAR_S seconds as the planet takes them in
      const rH = hillOf(planets[i]);
      for (const c of clumps) if (c.amp > 0 && Math.abs(c.R - 0.05 * (time - c.t0) - Rc) < CLEAR * rH) c.gone = true;
      opt.mode |= 16;
      box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: opt.mode } }));
      emitState();
      // from afar the gap would be drawn shallow (DEPTH): come closer to watch it open
      if (Math.hypot(Math.hypot(cam[0], cam[1]) - Rc, cam[2]) > 3 * Rc) box.diskSet({ p: 0, slice: 0, el: Math.min(45, Math.max(25, camEl * 180 / Math.PI)), az: camAz * 180 / Math.PI, d: 3.3 * Rc, fly: 1 });
      const au = Rc.toFixed(Rc < 10 ? 1 : 0);
      say('小石が ' + au + ' au に集まって惑星の核ができ、まわりの小石とガスを取り込んで木星ほどの惑星に育ちました。惑星はガスを押しのけてギャップを開け、すぐ外に小石がたまります(実際には数十万年以上かかります)。',
        'The pebbles gathered at ' + au + ' au into a planetary core; it took in the pebbles and gas around it and grew to the mass of Jupiter. The planet pushes the gas aside into a gap, and pebbles pile up just outside it (in reality this takes hundreds of thousands of years or more).', 12000,
        '小石が集まって惑星の核ができ、木星ほどの惑星に育ちました。ギャップが開き、すぐ外に小石がたまります。',
        'The pebbles grew into a planet as massive as Jupiter; it opens a gap, and pebbles pile up just outside it.');
    };

    // --- the envelope: fades in and out with its component (1.5 s) and shows with the camera's distance (envVis): faintly
    // from 40 to 90 au (K of its light), fully from 110 to 260 au (round 8; before, from 110 to 190 au only) ---
    const ENV_FADE = { K: 0.35, NEAR: [40, 90], FAR: [110, 260] };
    let envAmp = (opt.mode & 32) ? 1 : 0, envVis = 0;
    // its infall: particles on NS streamlines (SVG dots, like the wind's), from r = 225 au down to the disk's surface
    // (z/R below 0.17), moving ENV.SPEED times faster than the disk's clock, and the streamlines themselves, faint.
    // Each streamline is integrated once in theta (800 steps) with the velocities of ENV, then resampled at equal
    // times (for the particles) and every 40 steps (for the line).
    const GM = 0.5236 * 0.5236;           // au^3 per (visual s)^2: one orbit a year at 1 au (12 s)
    const envLines = [];
    for (let i = 0; i < ENV.NS; i++) {
      const [u1, u2] = sobol2(i + 37);
      const th0 = ENV.TH_CAV + 0.08 + (1.38 - ENV.TH_CAV - 0.08) * u1, c0 = Math.cos(th0), s0 = Math.sin(th0), RC = ENV.RC;
      let th = Math.acos(c0 * (1 - RC * s0 * s0 / 225)), t = 0, ph = 0;
      const dth = (Math.PI / 2 - th) / 800, raw = [];
      for (let k = 0; k <= 800; k++) {
        const c = Math.cos(th), sn = Math.sin(th), r = RC * s0 * s0 / (1 - c / c0);
        raw.push([t, r, th, ph]);
        if (r * c < 0.17 * r * sn) break;
        const k0 = Math.sqrt(GM / r), vt = k0 * (c0 - c) * Math.sqrt((c0 + c) / (c0 * sn * sn)), vp = k0 * (s0 / sn) * Math.sqrt(Math.max(1 - c / c0, 0));
        const dt = r * dth / vt;
        t += dt; ph += vp / (r * sn) * dt; th += dth;
      }
      const T = raw[raw.length - 1][0], K = 96, pts = [];
      for (let k = 0, j = 0; k < K; k++) {
        const tk = T * k / (K - 1);
        while (j < raw.length - 2 && raw[j + 1][0] < tk) j++;
        const a = raw[j], b = raw[j + 1], f = Math.min(1, (tk - a[0]) / (b[0] - a[0] || 1));
        pts.push([a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]);
      }
      const line = raw.filter((_, k) => k % 40 === 0 || k === raw.length - 1).map((a) => [a[1], a[2], a[3]]);
      envLines.push({ phi0: 2 * Math.PI * u2, side: i % 2 ? -1 : 1, T, pts, line });
    }
    // each planet's depth for this view (to 1e-3), the starlight on its gap, its rim and pebble trap; its wake's strength
    // (round 7) each shown planet as a point of light seen from afar (uPlG): instead of the small ring that marked it
    // (round 3), the planet and its own disk glow, so that they can be found and clicked from any distance. In the model's
    // look fully; in the observed looks as far as a young planet's disk shows at those wavelengths, a display choice:
    // faintly in the near-infrared of the visible look and in the millimetre (its dust, as the disk of PDS 70 c), more in the
    // mid-infrared (its warm inner part); not in the CO line (PLANET_GLOW). The point fades as its resolved disk shows close
    // up (planetLight), and is left out where the cut takes the planet away.
    const PLANET_GLOW = { model: 1, optical: 0.15, mir: 0.5, mm: 0.25, co: 0 };
    const glowOf = (p) => Math.min(1.8, Math.max(0.25, Math.sqrt(p.m)));   // (round 8: brighter for a heavier planet, see MASS)
    // (round 8) the planet's own disk: H/r of its three clouds (see uCpd in the shader) and its glow
    const CPD_X = [0.1, 0.3, 0.55].map((w) => 1.5 * w * 0.4);   // the clouds' half-light radii in Hill radii
    const cpdOf = (p) => {
      if (!p) return [0.1, 0.1, 0.1, 1];
      const hp = MODEL.H0 * Math.pow(p.a, 0.25), qth = p.q / (hp * hp * hp);
      return [...CPD_X.map((x) => Math.min(0.8, Math.max(0.1, 0.83 * Math.pow(qth, -1 / 3) * Math.sqrt(x) / Math.sqrt(1 + x * x * x / 3)))), glowOf(p)];
    };
    box.diskCpd = (i = 0) => cpdOf(planets[i]);   // (for checks: a planet's disk's H/r, three clouds, and glow)
    const plGlowD = new Float32Array(4 * PLANETS.MAX);
    function planetGlowSet(pV, pVis) {
      plGlowD.fill(0);
      planets.forEach((p, i) => {
        if (i >= PLANETS.MAX || p.amp <= 0) return;
        const P = planetPosOf(p, time);
        const w = p.amp * (PLANET_GLOW[lookNow] || 0) * glowOf(p) * (p === pV ? 1 - ss(0.3, 0.8, pVis) : 1) * (kept(P) ? 1 : 0);
        plGlowD.set([P[0], P[1], P[2], w], 4 * i);
      });
    }
    const plData = new Float32Array(4 * PLANETS.MAX), plTrapD = new Float32Array(4 * PLANETS.MAX), plRimD = new Float32Array(4 * PLANETS.MAX), plGapD = new Float32Array(4 * PLANETS.MAX);
    // (the planets that act now, a gap or a wake, are packed into the first plNP places, so that the shaders' loops
    // stop after them: with one planet they cost about what the single planet did)
    let plNP = 0, plRows = null, gapR = [1e9, 0];   // (plRows null: the table is made once at least)
    const plLightAll = new Float32Array(128 * PLANETS.MAX);
    // (round 9) While a planet's slider is dragged (diskSet's drag: 1), its gap's starlight (gapLight: three ray traces of
    // some 95 000 steps for a radius not met before) and its rim are made anew at most every PL_FULL_MS; between, the row
    // made for the radius (and mass) before is used as it is (its radii are in units of a, so it moves with the planet: the
    // stretch used until round 6) and the rim moves with a. On release (drag: 0) every row made so is made in full.
    const PL_FULL_MS = 120;
    let plDrag = false, plFullT = 0;
    function planetUniforms() {
      const tNow = performance.now();
      planets.forEach((p) => {
        // (round 6: the gap's depth is its profile's, 1 - Sigma_min / Sigma_0, from every distance and in every look)
        const d = Math.round(p.amp * gapK(p.a, p.q).depth * 10000) / 10000;
        if (d !== p.dSet || p.a !== p.aSet || p.q !== p.qSet || (p.rough && !plDrag)) {
          if (plDrag && p.aSet > 0 && tNow - plFullT < PL_FULL_MS) {
            if (p.rim) { const f = p.a / p.aSet; p.rim = { ...p.rim, R: p.rim.R * f, end: p.rim.end * f }; }
            p.rough = true; p.dSet = p.d = d; p.aSet = p.a; p.qSet = p.q;
          } else {
            p.dSet = p.d = d; p.aSet = p.a; p.qSet = p.q; p.rough = false; gapLight(p.a, p.q)(d, p.light); p.rim = d > 0 ? gapRim(d, p.a, p.q) : null;
            if (plDrag) plFullT = tNow;
          }
        }
        // (round 8: the wake's amplitude as the planet's mass in thermal masses, q / h_p^3, up to 1; see MASS)
        const hp = MODEL.H0 * Math.pow(p.a, 0.25);
        p.wake = p.amp * (lookNow === 'model' ? wakeFor(cam, p.a) : 1) * Math.min(1, p.q / (hp * hp * hp));
      });
      // (the pebbles' traps, each with the other planets' gaps: neighbours' gaps may join and leave no maximum between)
      planets.forEach((p) => { p.trap = trapOf(p.d, p.a, planets.filter((o) => o !== p && o.d > 0).map((o) => ({ a: o.a, d: o.d, q: o.q })), p.q); });
      const act = planets.filter((p) => p.d > 0 || p.wake > 0);
      plNP = act.length;
      for (let i = 0; i < PLANETS.MAX; i++) {
        const p = act[i];
        plData.set(p ? [p.a, p.d, planetPhiOf(p, time) % (2 * Math.PI), p.wake] : [PLANET.A, 0, 0, 0], 4 * i);
        plTrapD.set(p ? [p.trap.R, p.trap.filt, p.trap.s, p.trap.w] : [0, 0, 0, 1], 4 * i);
        const gk = p ? gapK(p.a, p.q) : null;
        plGapD.set(gk ? [gk.dR1, gk.dR2, gk.k4 * p.a, gk.smin] : [0, 0, 1, 1], 4 * i);
        plRimD.set(p && p.rim ? [p.rim.R, p.rim.th, p.rim.end, p.rim.h] : [1e9, 0, 0, 1], 4 * i);
      }
      // the gap-light rows, in the same places, and the gaps' table (again when a depth or the packing changes)
      const key = act.map((p) => p.a + '/' + p.q + '/' + p.d).join(',');
      if (key !== plRows) {
        plRows = key;
        act.forEach((p, i) => plLightAll.set(p.light, 128 * i));
        const on = act.filter((p) => p.d > 0);
        gapR = on.length ? [Math.min(...on.map((p) => p.a - 1.02 * gapK(p.a, p.q).dR2)), Math.max(...on.map((p) => p.a + 1.02 * gapK(p.a, p.q).dR2))] : [1e9, 0];
        const dln = Math.log(2000) / (GT_N - 1), ln0 = Math.log(0.02);
        for (let j = 0; j < GT_N; j++) {
          const R = Math.exp(ln0 + j * dln);
          let lf = 0, sl = 0;
          for (const p of act) {
            // (the factor 1 - d s(R) and its share of d ln Sigma / d ln R, -R d s'(R) / (1 - d s); s' is -/+ 4 / (k4 a (1 - smin))
            // on the walls outside and inside the orbit, 0 elsewhere)
            const k = gapK(p.a, p.q), y = Math.abs(R - p.a);
            if (p.d <= 0 || y >= k.dR2) continue;
            const sh = gapShape(R, p.a, p.q), ds = y <= k.dR1 ? 0 : -Math.sign(R - p.a) * 4 / (k.k4 * p.a * (1 - k.smin));
            lf += Math.log(1 - p.d * sh); sl += -R * p.d * ds / (1 - p.d * sh);
          }
          gapTD[2 * j] = lf; gapTD[2 * j + 1] = sl;
        }
        const unit = gl.getParameter(gl.ACTIVE_TEXTURE);   // (the passes bind on the unit they find active: leave it so)
        gl.activeTexture(gl.TEXTURE13); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, PLANETS.MAX, gl.RED, gl.FLOAT, plLightAll);
        gl.activeTexture(gl.TEXTURE14); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GT_N, 1, gl.RG, gl.FLOAT, gapTD);
        gl.activeTexture(unit);
      }
    }

    // The camera looks at the star, or (follow) at the planet, turning with its orbit, or at a point moved from it by the
    // pan (panV, au, in the frame that turns with the view: the slow spin, or the planet's orbit, so that what is framed
    // stays framed; Shift+drag, the middle or right button, two fingers, Shift+arrows; Home and the planet's view bring it
    // back, the cut looks at the star and restores it when closed). Every change of view (buttons,
    // keys, the wheel, the tour) flies there: the view (elevation, azimuth the shorter way round, ln distance) and the
    // point looked at each move on a cubic Hermite curve that starts with the camera's present velocity, so that a
    // flight redirected on the way (a second click, a held key, the wheel) carries on smoothly, and ends at rest. The
    // duration grows with the size of the move, from FLY_MIN to FLY_MAX seconds, for an even pace. Flights aim at the
    // view as it is at each moment (the slow spin and the planet's orbit keep moving it). A drag or a pinch takes over:
    // the view stays where it is (the point looked at still settles). With reduced motion, views change at once.
    const FLY_MIN = 0.35, FLY_MAX = 1.6, wrapPi = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
    let follow = false, flyV = null, flyT = null, camT = [0, 0, 0], camEl = opt.el, camAz = opt.az, camD = opt.dist;
    let camV = [0, 0, 0], camTV = [0, 0, 0];   // velocities of the view and of the point looked at, per second
    const viewOff = () => (follow ? planetPhi(time) : reduce ? 0 : opt.spin * time);
    let panV = [0, 0, 0];
    const PAN_MAX = 400;
    // the point looked at now (without a flight): the star or the planet, and the pan turned with the view
    const lookAt = () => {
      const B = follow ? planetPos(time) : [0, 0, 0], a = viewOff(), c = Math.cos(a), s = Math.sin(a);
      return [B[0] + c * panV[0] - s * panV[1], B[1] + s * panV[0] + c * panV[1], B[2] + panV[2]];
    };
    // the pan that makes the point looked at P (the inverse of lookAt)
    const panOf = (P) => {
      const B = follow ? planetPos(time) : [0, 0, 0], a = viewOff(), c = Math.cos(a), s = Math.sin(a), x = P[0] - B[0], y = P[1] - B[1];
      return [c * x + s * y, -s * x + c * y, P[2] - B[2]];
    };
    const clampPan = (v) => { const m = Math.hypot(v[0], v[1], v[2]); return m > PAN_MAX ? v.map((x) => x * PAN_MAX / m) : v; };
    // position (out) and velocity (vel) along a flight now; true when it has arrived
    function hermite(fl, p1, out, vel) {
      const u = Math.min(1, (performance.now() - fl.t0) / (1000 * fl.dur)), u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = 6 * u - 6 * u2;
      for (let i = 0; i < p1.length; i++) {
        out[i] = h00 * fl.p0[i] + h10 * fl.dur * fl.v0[i] + h01 * p1[i];
        vel[i] = (d00 * fl.p0[i] + d10 * fl.dur * fl.v0[i] + d01 * p1[i]) / fl.dur;
      }
      return u >= 1;
    }
    // start (or redirect) a flight from where the camera is to the view set now
    function startFly() {
      if (reduce || !W || !cam) { flyV = flyT = null; return; }
      const now = performance.now(), p0 = [camEl, camAz, Math.log(camD)], to = [elUser, azUser + viewOff(), Math.log(opt.dist)];
      to[1] = p0[1] + wrapPi(to[1] - p0[1]);
      const Tl = lookAt(), dT = Math.hypot(Tl[0] - camT[0], Tl[1] - camT[1], Tl[2] - camT[2]);
      const m = Math.abs(to[0] - p0[0]) + Math.abs(to[1] - p0[1]) * Math.cos(p0[0]) + Math.abs(to[2] - p0[2]) + dT / Math.max(1, Math.min(camD, opt.dist));
      const dur = Math.min(FLY_MAX, FLY_MIN + 0.45 * m);
      flyV = { t0: now, dur, p0, v0: camV.slice() };
      if (dT > 1e-6 || flyT) flyT = { t0: now, dur, p0: camT.slice(), v0: camTV.slice() };
      dirty = true;
    }
    // a drag or a pinch takes over: the view is left where the flight has brought it
    const takeOver = () => {
      if (!flyT && !flyV) return;
      const before = [elUser, wrapPi(azUser + viewOff()), Math.log(opt.dist), ...lookAt()];
      if (flyT) { panV = clampPan(panOf(camT)); flyT = null; camTV = [0, 0, 0]; }
      if (flyV) { elUser = clampEl(camEl); azUser = camAz - viewOff(); opt.dist = camD; flyV = null; camV = [0, 0, 0]; }
      const after = [elUser, wrapPi(azUser + viewOff()), Math.log(opt.dist), ...lookAt()];
      // A pointer-down can stop a flight without any drag. If it changes the requested view, the saved range belongs
      // to the abandoned destination; a settled click (or a target equal within roundoff) keeps its calibration.
      const changed = after.some((v, i) => Math.abs(i === 1 ? wrapPi(v - before[i]) : v - before[i]) > 1e-9 * Math.max(1, Math.abs(v), Math.abs(before[i])));
      if (changed && (coPending || coSavedKey || coHold)) coResume();
    };
    // the pan by a move of dx, dy pixels on the screen: the point looked at moves against it in the picture's plane, as
    // far as a pixel spans at its distance, so that what is under the pointer follows it
    const panBy = (dx, dy) => {
      if (!basis || !Hh) return;
      const k = 2 * camD * Math.tan(opt.fov / 2) / Hh, P = lookAt();
      for (let i = 0; i < 3; i++) P[i] += (-dx * basis.r[i] + dy * basis.u[i]) * k;
      panV = clampPan(panOf(P));
    };
    // The overlay leaves out points nearer the camera than zN (behind it, or so near that they would be thrown far off the
    // screen): in proportion to the camera's distance from the point it looks at, up to 0.05 au, so that close to the
    // star (0.04 au) the lines in front of it and the scale bar stay (a fixed 0.05 au dropped them inside 0.1 au)
    let zN = 0.05;
    function camera() {
      const Tl = lookAt(), vl = [elUser, azUser + viewOff(), Math.log(opt.dist)];
      let T = Tl, v = vl;
      if (flyT) { const o = [0, 0, 0]; if (hermite(flyT, Tl, o, camTV)) { flyT = null; camTV = [0, 0, 0]; } else T = o; }
      if (flyV) {
        vl[1] = flyV.p0[1] + wrapPi(vl[1] - flyV.p0[1]);
        const o = [0, 0, 0];
        if (hermite(flyV, vl, o, camV)) { flyV = null; camV = [0, 0, 0]; } else v = o;
      }
      camT = T; camEl = v[0]; camAz = v[1]; camD = Math.exp(v[2]);
      zN = Math.min(0.05, 0.02 * camD);
      const el = camEl, az = camAz, d = camD;
      const f = [-Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), -Math.sin(el)];
      cam = [T[0] - d * f[0], T[1] - d * f[1], T[2] - d * f[2]];
      const r = [f[1], -f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r[0] /= rl; r[1] /= rl;
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      basis = { f, r, u, n: [r[1], -r[0], 0], th: Math.tan(opt.fov / 2) };
    }
    function project(p) {
      const v = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      const x = v[0] * basis.r[0] + v[1] * basis.r[1] + v[2] * basis.r[2];
      const y = v[0] * basis.u[0] + v[1] * basis.u[1] + v[2] * basis.u[2];
      const z = v[0] * basis.f[0] + v[1] * basis.f[1] + v[2] * basis.f[2], th = basis.th;
      return [(x / (z * th * (W / Hh)) + 1) / 2 * W, (1 - y / (z * th)) / 2 * Hh, z];
    }
    // --- the slice: lines and labels on the cut face, in its plane (Rs along basis.r, signed, and z), from the
    // same expressions as the volume; the quantities none (the gas itself), T, rho, tau and layers (of the coupling,
    // see layersFace) ---
    const SZ = 1;                        // vertical scale of the face (uSliceZ); 1: true proportions
    // (Disk Lab v2, round 6: the quantities 'none' (the cut as it is, the gas behind it thinned) and 'tau' (the optical
    // depth toward the star) are gone, the owner's choice; a link or a script that asks for them gets the nearest that
    // is left, SQ_OLD: the density for 'none', whose contours it showed, the temperature for 'tau', whose line tau* = 1
    // it keeps)
    const SLICE_Q = { T: 1, rho: 2, layers: 4 }, SQ_OLD = { none: 'rho', tau: 'T' };
    const sqOf = (v) => (own(SLICE_Q, v) ? v : own(SQ_OLD, v) ? SQ_OLD[v] : null);
    const sliceG = overlay.querySelector('.disk-slice');
    // the CO look's colour bar and channel velocity (top left; the cut, whose bar sits there, is closed in the observed
    // looks)
    const coG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    overlay.appendChild(coG);
    const LN10 = Math.LN10, CHI_C = 0.03;
    // ln tau* toward the star with the planets' gaps, behind each inner rim at least that of the rim (as xRim)
    const lnTauJS = (R, z) => {
      let x = MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) + gapLnAll(R) - 0.5 * z * z / (Hof(R) * Hof(R));
      const th = Math.abs(z) / R;
      for (const rim of rims()) {
        if (R <= rim.R || R > rim.end + 0.5) continue;
        const xr = 0.5 * (rim.th * rim.th - th * th) / (rim.h * rim.h);
        x += (Math.max(x, xr) - x) * (1 - ss(rim.end, rim.end + 0.5, R));
      }
      return x;
    };
    // height where ln tau* = lt (the irradiation surface for lt = 0), and where the disk gas is 10^lr of the
    // midplane at 1 au; NaN where the column does not reach it. Behind the gap's rim tau* is found by bisection.
    const zOfTau = (R, lt) => {
      if (rims().some((rim) => R > rim.R && R < rim.end + 0.5)) {
        if (lnTauJS(R, 0) < lt) return NaN;
        let lo = 0, hi = 0.5 * R;
        for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (lnTauJS(R, m) > lt) lo = m; else hi = m; }
        return 0.5 * (lo + hi);
      }
      const a = MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) + gapLnAll(R) - lt;
      return a > 0 ? Hof(R) * Math.sqrt(2 * a) : NaN;
    };
    const zOfRho = (R, lr) => { const v = Math.log(SigmaJS(R) * Math.exp(gapLnAll(R)) * MODEL.H0 / Hof(R)) - lr * LN10; return v > 0 ? Hof(R) * Math.sqrt(2 * v) : NaN; };
    const sliceGeom = {};               // lines in (R, z), R >= 0 and z >= 0, built once per quantity and gap depth
    // the wake (as in the disk map, without the footprint): relative excess of the gas density at R, azimuth phi
    const wake1JS = (p, R, phi) => {
      const x = R / p.a, HP = MODEL.H0 * Math.pow(p.a, 0.25);
      if (p.wake <= 0 || x < 0.42 || x > 2.5) return 0;
      const F = 4.8 - 4 * Math.pow(x, -0.25) - 0.8 * Math.pow(x, 1.25), TAU = 2 * Math.PI;
      const dphi = ((phi - planetPhiOf(p, time) - Math.sign(x - 1) * F / HP + Math.PI) % TAU + TAU) % TAU - Math.PI;
      const sl = Math.pow(x, 1.25) * Math.abs(Math.pow(x, -1.5) - 1) / HP, c = 1 / Math.sqrt(1 + sl * sl);
      const ax = Math.abs(x - 1), w = Hof(R) * (1 + 0.5 * ax), d = R * dphi * c;
      const amp = PLANET.WAKE_P * Math.pow(Math.max(ax, PLANET.WAKE_X0) / PLANET.WAKE_X0, x > 1 ? -PLANET.WAKE_NO : -PLANET.WAKE_NI) * (1 - wavesAmp) + PLANET.WAKE_A * Math.exp(-ax / PLANET.WAKE_L) * wavesAmp;
      return p.wake * amp * ss(0.03, 0.1, ax) * ss(0.42, 0.55, x) * (1 - ss(2, 2.5, x)) * Math.exp(-d * d / (w * w));
    };
    const wakeJS = (R, phi) => planets.reduce((s, p) => s + wake1JS(p, R, phi), 0);
    const anyWake = () => planets.some((p) => p.wake > 0);
    // the disk's density contours on the two faces (or halves of the face; at the azimuths of cutE), across the arms:
    // finely sampled where the arms are
    let wakeR = null;
    function wakeContours(lr) {
      // (finely sampled where each planet's arms are, 0.42 a to 2.5 a)
      const wk = planets.map((p) => p.a).join(',');
      if (!wakeR || wakeR.key !== wk) {
        const rs = [...logspace(MODEL.R_IN * 1.05, RB_JS - 1, 120)];
        for (const p of planets) rs.push(...logspace(0.42 * p.a, Math.min(2.5 * p.a, RB_JS - 1), 420));
        wakeR = rs.filter((R) => R < RB_JS - 1).sort((a, b) => a - b); wakeR.key = wk;
      }
      const out = [];
      for (const [sr, ph] of [[1, Math.atan2(cutE[1][1], cutE[1][0])], [-1, Math.atan2(cutE[0][1], cutE[0][0])]]) {
        const pts = [];
        for (const R of wakeR) {
          const v = Math.log(SigmaJS(R) * Math.exp(gapLnAll(R)) * (1 + wakeJS(R, ph)) * MODEL.H0 / Hof(R)) - lr * LN10;
          if (v > 0) pts.push([R, Hof(R) * Math.sqrt(2 * v)]);
        }
        if (pts.length > 2) out.push(pathOf(pts, [[sr, 1], [sr, -1]]));
      }
      return out.join('');
    }
    const logspace = (a, b, n) => Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
    function buildSlice(q) {
      const key = q + ':' + planetsKey() + ':' + rSn.toFixed(3) + ':' + (opt.asym ? 1 : 0);
      if (sliceGeom.key === key) return sliceGeom.g;
      const g = { lines: [], labels: [] };
      const curve = (f, R0, R1) => logspace(R0, R1, 160).map((R) => [R, f(R)]).filter((pt) => !isNaN(pt[1]));
      // (Disk Lab v2, round 6: no isotherms on the temperature's face, whose colour is its value; there the snow line is
      // the 160 K isotherm. No labels on the lines: the page's key says what each line is, the owner's "the labels on the
      // thin lines and the narrow layers say which one they mean poorly")
      if (q === 'rho') {
        // the density's contours, at the colour bar's ticks (10^0, 10^-3, 10^-6, 10^-9 of the midplane at 1 au), so that the
        // bar is their key: the disk's (10^0, 10^-3) and, along the field lines, the wind's (10^-6, 10^-9, where the
        // marched cylinder reaches them); with the planet, the disk's contours are drawn each frame instead, across the
        // arms of its wake (wakeContours)
        for (const lr of [0, -3]) {
          const c = curve((R) => zOfRho(R, lr), MODEL.R_IN * 1.05, RB_JS - 1);
          if (c.length > 2) g.lines.push({ pts: c, quads: ALL, lr });
        }
        // (the lower side has its own contours, at 0.1 of the upper with the wind's asymmetry, and its lines' own bases)
        const lowW = opt.asym ? WIND_LOW_JS : 1, sideS = opt.asym ? ASYM_F_JS : 0;
        for (const [lr, low, lower] of [[-6, 1, 0], [-9, 1, 0], [-6, lowW, 1], [-9, lowW, 1]]) {
          const c = [];
          for (const Rf of logspace(0.07, 30, 180)) {
            const zb = zBase(Rf), r0 = r0Of(Rf, lower ? -sideS : sideS), T = bpOf(Rf), lnEta = T.LNEK;   // (round 8: the line's own solution)
            const base = -MODEL.LNTAU1 - 1.5 * Math.log(r0) - LNREF - cutOut(r0) + gapLnAll(r0) + Math.log(Math.max(ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, r0) * low, 1e-30));
            const want = lr * LN10 - base;   // ln (ETA / kappa) with the loading's factor at the contour
            if (want > tabF(lnEta, tabS(CHI_C)) || want < lnEta[NT - 1]) continue;
            let lo = tabS(CHI_C), hi = NT - 1.001;
            for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (tabF(lnEta, m) > want) lo = m; else hi = m; }
            const chi = chiOfS(0.5 * (lo + hi)), z = zb + r0 * chi;
            if (z < ZB_JS) c.push([r0 * tabF(T.XI, tabS(chi)), z]);
          }
          if (c.length > 2) g.lines.push({ pts: c, quads: lower ? LOWER : UPPER });
        }
      }
      sliceGeom.key = key; sliceGeom.g = g;
      g.tau1 = logspace(MODEL.R_IN, RB_JS - 1, 300).map((R) => [R, zOfTau(R, 0)]).filter((pt) => !isNaN(pt[1]));
      // (the snow line on the faces: the 160 K surface of the temperature (round 7: tempAt), from the midplane at the snow
      // line up to where even the superheated grains in full starlight are colder (rIceS), and up along that radius to
      // the top of the painted face)
      const rs = rIceS();
      g.ice = [[rSn, 0], ...logspace(rSn * 1.0005, rs, 200).map((R) => [R, zIce(R)]).filter((pt) => !isNaN(pt[1])), [rs, zOfTau(rs, -4.6)]];
      return g;
    }
    const sup = (k) => String(k).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    // lines on every face: the irradiation surface (tau* = 1); the snow surface (the 160 K surface of the temperature); the
    // pebble layer; the field lines in the plane (the R-z shape of the solution) with points for the wind velocity
    // (round 7) where the superheated grains in full starlight are at TICE, the outer end of the snow surface
    const rIceS = () => Math.sqrt(THERMO.KDS5 * lumNow / Math.pow(MODEL.TICE, 5));
    // the height of the snow surface at R (rSn < R < rIceS): where the temperature, rising toward the lit surface, passes
    // TICE (bisection in z, up to well above the irradiation surface, tau* = 0.01)
    const zIce = (R) => {
      const top = zOfTau(R, -4.6), H = Hof(R), f = (z) => tempJS(R, z / H, lnTauJS(R, z), lumNow) - MODEL.TICE;
      if (isNaN(top) || f(0) >= 0 || f(top) < 0) return NaN;
      let lo = 0, hi = top;
      for (let i = 0; i < 36; i++) { const m = 0.5 * (lo + hi); if (f(m) < 0) lo = m; else hi = m; }
      return 0.5 * (lo + hi);
    };
    // (per side, for the asymmetry's share: made again when it changes)
    let planeLines = [], planeS = null;
    function shapePlaneLines(sNow) {
      if (sNow === planeS) return;
      planeS = sNow;
      planeLines = logspace(0.12, 25, 12).map((Rf) => {
        const side = (s) => {
          const zb = zBase(Rf), r0 = r0Of(Rf, s), pts = [], CHI_S = chiS(bpOf(Rf));
          for (const h of diskHeights(Rf, s)) pts.push([fieldRP(Rf, h, s)[0], h, -1]);
          for (const chi of CHI_S) { const h = zb + r0 * chi, R = fieldRP(Rf, h, s)[0]; if (h > ZB_JS - 0.5 || R > RB_JS) break; pts.push([R, h, chi]); }
          return { r0, pts, T: bpOf(Rf) };
        };
        return { up: side(sNow), low: side(-sNow) };
      });
    }
    const vK = (r0) => 29.78 / Math.sqrt(r0);   // km/s, for a star of one solar mass (one orbit a year at 1 au)
    // a slice element: a path with fixed style, or a pool of labels
    const mkS = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); sliceG.appendChild(e); return e; };
    const sP = {
      contour: mkS('path', { fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.55, 'stroke-width': 0.9 }),
      flines: mkS('path', { fill: 'none', stroke: '#cfe3ff', 'stroke-opacity': 0.5, 'stroke-width': 0.8 }),
      arrows: mkS('path', { fill: 'none', stroke: '#e8f4ff', 'stroke-opacity': 0.85, 'stroke-width': 1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      tau1: mkS('path', { fill: 'none', stroke: '#fff3df', 'stroke-opacity': 0.95, 'stroke-width': 1.5 }),
      // (round 6: the snow line thicker and more opaque, on a dark halo, so that it reads over the white of 160 K and over
      // the blue of the cold disk alike: the owner could not see it)
      // (round 8, the owner: "outlined dashes, not dashes on a solid line": the halo is dashed too, each dash 1 px longer at
      // either end than the blue one over it (9 2, shifted back by 1: blue 0-7, halo -1 to 8) and 1 px wider on either side,
      // so that every dash is outlined and the gaps are empty. Both run along the same path, so their phases agree on curves)
      iceHalo: mkS('path', { fill: 'none', stroke: '#0a0d18', 'stroke-opacity': 0.6, 'stroke-width': 4.6, 'stroke-dasharray': '9 2', 'stroke-dashoffset': 1, 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }),
      ice: mkS('path', { fill: 'none', stroke: '#6fd0ff', 'stroke-width': 2.6, 'stroke-dasharray': '7 4', 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }),
      rock: mkS('path', { fill: 'none', stroke: '#b07a52', 'stroke-width': 2.2 }),
      icy: mkS('path', { fill: 'none', stroke: '#e3f1ff', 'stroke-width': 2.2 }),
      pile: mkS('path', { fill: 'none', stroke: '#f2f8ff', 'stroke-width': 4 }),
      // (round 8, the owner: "the planets' marks on the cut: circles") a dot where a planet's orbit crosses the face, and a thin ring at its Hill
      // radius where that is wider than 8 px on the screen (it grows with the planet's mass)
      planet: mkS('path', { fill: '#ffd040', stroke: '#0a0d18', 'stroke-width': 1 }),
      hill: mkS('path', { fill: 'none', stroke: '#ffd040', 'stroke-opacity': 0.7, 'stroke-width': 1 }),
      dead: mkS('path', { fill: 'none', stroke: '#c9d4ff', 'stroke-opacity': 0.75, 'stroke-width': 1.2, 'stroke-dasharray': '1.5 3.5', 'stroke-linecap': 'round' }),
      acc: mkS('path', { fill: 'none', stroke: '#ffbe6a', 'stroke-opacity': 0.95, 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      // the 1/4 cut's edge, where its two planes meet along the axis, on the far side of the disk from the camera
      edge: mkS('path', { fill: 'none', stroke: '#dfeaff', 'stroke-opacity': 0.6, 'stroke-width': 1, 'stroke-dasharray': '3 4' }),
      // the X-points on the face, close to the star (where the star's closed lines meet the disk's open ones)
      xpt: mkS('path', { fill: 'none', stroke: '#ffecaa', 'stroke-opacity': 0.95, 'stroke-width': 1.6, 'stroke-linecap': 'round' })
    };
    // the dead zone's top, z_k(R), where there is one (from the thermally ionized edge out to where it ends)
    const deadTop = logspace(0.27, 7, 160).map((R) => [R, zKinkHJS(R) * Hof(R)]).filter(([, z]) => z > 0);
    const sLabels = [];
    // a colour bar for the painted face (top left), from the same colour maps as the shader
    const smooth = (a, b, x) => ss(a, b, x);
    const tcolorJS = (T) => {
      const l = Math.log(T), st = [[3.69, 4.50, [0.071, 0.325, 1.000]], [4.50, 4.98, [0.560, 0.800, 1.000]], [4.98, 5.16, [0.920, 0.900, 0.860]],
        [5.16, 5.86, [1.000, 0.325, 0.047]], [5.86, 6.68, [1.000, 0.560, 0.120]], [6.68, 7.38, [1.000, 0.860, 0.240]]];
      let c = [0.023, 0.148, 0.893];
      for (const [a, b, k] of st) { const t = smooth(a, b, l); c = c.map((v, i) => v + (k[i] - v) * t); }
      return c.map((v) => 0.92 * Math.pow(v, 1 / 2.2));
    };
    const MAPS = {
      viridis: [[0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530], [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
        [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318], [0.741, 0.873, 0.150], [0.993, 0.906, 0.144]],
      inferno: [[0.001, 0.000, 0.014], [0.087, 0.045, 0.225], [0.258, 0.039, 0.406], [0.416, 0.090, 0.433], [0.578, 0.148, 0.404], [0.736, 0.216, 0.330],
        [0.865, 0.317, 0.226], [0.955, 0.469, 0.100], [0.988, 0.645, 0.040], [0.964, 0.844, 0.273], [0.988, 0.998, 0.645]]
    };
    const cmapJS = (t, m) => { t = Math.min(Math.max(t, 0), 1) * 10; const i = Math.min(Math.floor(t), 9), f = t - i; return MAPS[m][i].map((v, k) => v + (MAPS[m][i + 1][k] - v) * f); };
    // per quantity: colour at u in [0, 1] along the bar, ticks (u, text) and a title
    const T0 = 30, T1 = 2000, uT = (T) => Math.log(T / T0) / Math.log(T1 / T0);
    const CBAR = {
      T: { col: (u) => tcolorJS(T0 * Math.pow(T1 / T0, u)), ticks: [50, 160, 300, 1000].map((T) => [uT(T), String(T)]), title: ['温度 (K)', 'temperature (K)'], units: 'K', min: T0, max: T1,
        description: ['色は温度を対数の尺度で示します。白い線は星の光が届く深さ(τ* = 1)、水色の破線はスノーライン(160 K)です。', 'Colour shows temperature on a logarithmic scale. The white line is where starlight reaches (tau* = 1); the dashed blue line is the snow line (160 K).'] },
      rho: { col: (u) => cmapJS(u, 'viridis'), ticks: [-9, -6, -3, 0].map((l) => [(l + 10) / 12.5, '10' + sup(l)]), title: ['ガスの密度(1 au の赤道面に対する比)', 'gas density (relative to the midplane at 1 au)'], units: '', min: 1e-10, max: Math.pow(10, 2.5),
        description: ['密度は 1 au の赤道面に対する比で、色は対数の尺度です。細い線は目盛りの値の等密度線です。', 'Density is relative to the midplane at 1 au; the colour scale is logarithmic. The thin lines are contours at the ticks\u2019 values.'] },
      // the layers of the coupling: swatches (the colours of layersFace)
      // (round 6: one region for each point of the face, and names that do not overlap: the strong turbulence of the hot
      // inner disk and the weak one of the outer disk; the laminar gas and the accretion layer, the part of it that flows
      // in. The dust-free gas close to the star is in the strong turbulence's region, as its coupling is)
      // (round 8: named by what happens there, one axis: no "laminar" (the dead zone, the accretion layer and the wind all
      // are); the wind-launching region between the accretion layer and the wind's base; the Hall layer with the asymmetry)
      layers: { swatches: [['#e0784a', '乱流(熱電離)', 'turbulence (thermally ionized)'], ['#273157', 'デッドゾーン', 'dead zone'], ['#ffb547', '降着層', 'accretion layer'], ['#5c9eb3', '風の根元', 'wind base'], ['#a3d9f2', '円盤風', 'disk wind'], ['#ba8f99', '弱い乱流', 'weak turbulence']],
        title: ['領域(何が起きている所か)', 'regions (what happens there)'], units: '', min: null, max: null,
        description: ['色は、乱流、デッドゾーン、降着層、風の根元、円盤風など、何が起きている所かで分けた領域を示します。', 'Colours mark the regions by what happens there: turbulence, the dead zone, the accretion layer, the wind base, the wind.'] }
    };
    // The painted face and its text counterpart use the same swatches, including the close stellar regions (round 6: on
    // every face, under the bar too, since their names on the face are gone; the gas falling onto the star is not the
    // accretion layer's, hence not called accretion)
    const MAG_SW = [['#9a7adb', '磁気圏', 'magnetosphere'], ['#ff5c80', '星へ落ちるガス', 'infall onto the star']];
    const HALL_SW = ['#8a995c', 'ホール効果の層', 'Hall layer'];   // (round 8: with the asymmetry, see LAY_HALL)
    const JET_SW = ['#ff6b5c', 'ジェット', 'jet'];                  // (round 8: with the jet shown, see LAY_JET)
    const layerSwatches = (c) => (c.swatches || []).concat(c.swatches && asymSm() > 0.5 ? [HALL_SW] : [], c.swatches && (opt.mode & 64) ? [JET_SW] : [], magFrame.vis > 0.5 ? MAG_SW : []);
    const cbarId = 'disk-cbar-' + Math.random().toString(36).slice(2, 9);
    const cbarDefs = mkS('defs', {});
    cbarDefs.innerHTML = '<linearGradient id="' + cbarId + '" x1="0" x2="1" y1="0" y2="0"></linearGradient>';
    const cbarGrad = cbarDefs.firstChild;
    const CBW = 220;
    const cbarRect = mkS('rect', { x: 18, y: 24, width: CBW, height: 8, fill: 'url(#' + cbarId + ')', stroke: 'rgba(190,215,240,0.5)', 'stroke-width': 0.6 });
    // a dark backing under the legend (beneath everything on the slice), so that it reads over the bright wind and faces
    const cbarBack = mkS('rect', { x: 8, y: 4, rx: 5, fill: 'rgba(8,11,20,0.62)' });
    sliceG.insertBefore(cbarBack, sliceG.firstChild);
    const textW = (t) => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.3), 0);   // (the labels' width, about, in px)
    const backTo = (e, right, bottom) => { e.setAttribute('width', Math.max(0, right - 8 + 10).toFixed(0)); e.setAttribute('height', Math.max(0, bottom - 4).toFixed(0)); };
    const cbarTicks = mkS('path', { fill: 'none', stroke: 'rgba(190,215,240,0.8)', 'stroke-width': 1 });
    let cbarFor = '';
    const swatchRects = [];
    function drawCbar(q, li) {
      const c = CBAR[q];
      cbarRect.setAttribute('visibility', c && !c.swatches ? 'visible' : 'hidden');
      cbarBack.setAttribute('visibility', c ? 'visible' : 'hidden');
      swatchRects.forEach((e) => e.setAttribute('visibility', 'hidden'));
      if (!c) { cbarTicks.setAttribute('d', ''); return li; }
      const title = c.title[ja() ? 0 : 1];
      if (c.swatches) {
        cbarTicks.setAttribute('d', '');
        let x = 18, y = 25, right = 18 + textW(title);
        // (close to the star, the magnetosphere's regions too; on a narrow panel the swatches wrap onto more rows)
        const sw = layerSwatches(c);
        sw.forEach(([col, ja_, en], i) => {
          const t = ja() ? ja_ : en, w = 14 + textW(t);
          if (x > 18 && x + w > W - 14) { x = 18; y += 17; }
          if (!swatchRects[i]) swatchRects[i] = mkS('rect', { width: 10, height: 10, stroke: 'rgba(190,215,240,0.5)', 'stroke-width': 0.6 });
          const e = swatchRects[i]; e.setAttribute('x', x); e.setAttribute('y', y); e.setAttribute('fill', col); e.setAttribute('visibility', 'visible');
          sLabel(li++, x + 14, y + 9, t);
          right = Math.max(right, x + w); x += w + 12;
        });
        sLabel(li++, 18, 18, title);
        backTo(cbarBack, right, y + 16);
        return li;
      }
      if (cbarFor !== q) {
        cbarGrad.innerHTML = Array.from({ length: 25 }, (_, i) => { const u = i / 24, k = c.col(u).map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))); return '<stop offset="' + u.toFixed(3) + '" stop-color="rgb(' + k.join(',') + ')"/>'; }).join('');
        cbarFor = q;
      }
      let d = '';
      for (const [u, t] of c.ticks) { const x = 18 + CBW * u; d += 'M' + x.toFixed(1) + ' 32L' + x.toFixed(1) + ' 36'; sLabel(li++, x, 47, t, 'middle'); }
      cbarTicks.setAttribute('d', d);
      sLabel(li++, 18, 18, title);
      // (close to the star, the magnetosphere's two regions under the bar)
      let right = Math.max(18 + CBW + 14, 18 + textW(title)), bottom = 53;
      if (magFrame.vis > 0.5) {
        let x = 18;
        MAG_SW.forEach(([col, ja_, en], i) => {
          const t = ja() ? ja_ : en, w = 14 + textW(t);
          if (!swatchRects[i]) swatchRects[i] = mkS('rect', { width: 10, height: 10, stroke: 'rgba(190,215,240,0.5)', 'stroke-width': 0.6 });
          const e = swatchRects[i]; e.setAttribute('x', x); e.setAttribute('y', 57); e.setAttribute('fill', col); e.setAttribute('visibility', 'visible');
          sLabel(li++, x + 14, 66, t); right = Math.max(right, x + w); x += w + 12;
        });
        bottom = 72;
      }
      backTo(cbarBack, right, bottom);
      return li;
    }
    const coE = {};
    // the colour bar's ticks for a range top (the bar is the square root of the value): round values near the given
    // shares of it (to two figures), at their places
    const coTicks = (top, shares) => shares.map((f) => {
      const v = top * f, p = Math.pow(10, Math.floor(Math.log10(v)) - 1), r = Math.round(v / p) * p;
      const n = r >= 100 ? Math.round(r / 10) * 10 : r;
      return [Math.min(1, Math.sqrt(n / top)), String(n)];
    });
    // One definition for the CO bar and its accessible text; the scale is the shader's existing one.
    const coSpec = () => {
      const rng = coRange(), mode = opt.coMode, top = (mode === 'm0' ? 900 : 220) * Math.exp(coLn);
      const div = (u) => { const v = 2 * u - 1, g = [0.60, 0.61, 0.64], b = [0.20, 0.36, 0.92], r = [0.88, 0.16, 0.12]; return g.map((c, i) => c + ((v < 0 ? b : r)[i] - c) * Math.abs(v)); };
      return mode === 'm1' ? { col: div, ticks: [[0, '−' + rng.toFixed(0)], [0.5, '0'], [1, '+' + rng.toFixed(0)]], title: ['平均の視線速度 (km/s、赤は遠ざかる)', 'mean line-of-sight velocity (km/s, red receding)'], units: 'km/s', min: -rng, max: rng,
        description: ['赤は遠ざかるガス、青は近づくガスです。', 'Red gas recedes; blue gas approaches.'] }
        : mode === 'm0' ? { col: (u) => cmapJS(u, 'inferno'), ticks: coTicks(top, [1 / 9, 4 / 9, 1]), title: ['輝線の積分強度 (K km/s)', 'line integrated intensity (K km/s)'], units: 'K km/s', min: 0, max: top,
          description: ['色は速度にわたって積分した強度の平方根を示します。', 'Colour follows the square root of intensity integrated over velocity.'] }
          : { col: (u) => cmapJS(u, 'inferno'), ticks: coTicks(top, [25 / 220, 100 / 220, 1]), title: ['輝線の輝度温度 (K)', 'line brightness temperature (K)'], units: 'K', min: 0, max: top,
            description: ['チャンネル ' + opt.coV.toFixed(2) + ' km/s。色は輝度温度の平方根を示します。', 'Channel ' + opt.coV.toFixed(2) + ' km/s. Colour follows the square root of brightness temperature.'] };
    };
    function drawCoBar() {
      const on = lookNow === 'co' && annAmp > 0;
      coG.setAttribute('opacity', on ? annAmp.toFixed(3) : '0');
      if (!on) return;
      if (!coE.rect) {
        const mk = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); coG.appendChild(e); return e; };
        const id = 'disk-cobar-' + Math.random().toString(36).slice(2, 9);
        coE.back = mk('rect', { x: 8, y: 4, rx: 5, fill: 'rgba(8,11,20,0.62)' });   // (a dark backing, as the cut's legend has)
        const defs = mk('defs', {}); defs.innerHTML = '<linearGradient id="' + id + '" x1="0" x2="1" y1="0" y2="0"></linearGradient>';
        coE.grad = defs.firstChild;
        coE.rect = mk('rect', { x: 18, y: 24, width: CBW, height: 8, fill: 'url(#' + id + ')', stroke: 'rgba(190,215,240,0.5)', 'stroke-width': 0.6 });
        coE.ticks = mk('path', { fill: 'none', stroke: 'rgba(190,215,240,0.8)', 'stroke-width': 1 });
        coE.texts = Array.from({ length: 6 }, () => mk('text', { class: 'disk-label', stroke: '#0a0d18', 'stroke-width': 3, 'stroke-opacity': 0.75, 'paint-order': 'stroke' }));
      }
      const j = ja(), rng = coRange(), mode = opt.coMode, key = mode + ':' + (mode === 'm1' ? rng.toFixed(1) : ''), spec = coSpec();   // (the colours; the ticks are set each frame)
      if (coE.key !== key) {
        coE.grad.innerHTML = Array.from({ length: 25 }, (_, i) => { const u = i / 24, k = spec.col(u).map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))); return '<stop offset="' + u.toFixed(3) + '" stop-color="rgb(' + k.join(',') + ')"/>'; }).join('');
        coE.key = key;
      }
      let d = '', n = 0;
      const txt = (x, y, t, anchor) => { const e = coE.texts[n++]; e.textContent = t; e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('text-anchor', anchor || 'start'); };
      for (const [u, t] of spec.ticks) { const x = 18 + CBW * u; d += 'M' + x.toFixed(1) + ' 32L' + x.toFixed(1) + ' 36'; txt(x, 47, t, 'middle'); }
      coE.ticks.setAttribute('d', d);
      const title = spec.title[j ? 0 : 1] + (j ? (coHold ? '・範囲:固定' : '・範囲:自動') : (coHold ? ' · range: fixed' : ' · range: auto'));
      txt(18, 18, title);
      // (the channel's velocity beside the bar, or under it on a narrow panel)
      const ch = (j ? 'チャンネル ' : 'channel ') + (opt.coV >= 0 ? '+' : '−') + Math.abs(opt.coV).toFixed(2) + ' km/s', chW = textW(ch), below = 18 + CBW + 14 + chW > W - 14;
      if (mode === 'chan') { if (below) txt(18, 66, ch); else txt(18 + CBW + 14, 33, ch); }
      while (n < coE.texts.length) coE.texts[n++].textContent = '';
      backTo(coE.back, Math.max(18 + CBW + 14 + (mode === 'chan' && !below ? chW : 0), 18 + textW(title)), mode === 'chan' && below ? 72 : 53);
    }
    // A read-only text counterpart to the current legend. It remains available when the SVG annotations are hidden.
    const legendSpec = () => {
      const j = ja() ? 0 : 1, c = lookNow === 'co' ? coSpec() : lookNow === 'model' && opt.slice ? CBAR[opt.sliceQ] : null;
      const rgb = (col) => 'rgb(' + col.map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))).join(',') + ')';
      if (c) return { title: c.title[j], description: c.description[j], units: c.units, min: c.min, max: c.max,
        rangeMode: lookNow === 'co' ? (coHold ? 'fixed' : 'auto') : 'fixed',
        items: c.swatches ? layerSwatches(c).map(([color, ja_, en]) => ({ label: j ? en : ja_, color })) : c.ticks.map(([u, label]) => ({ label, color: rgb(c.col(u)) })) };
      const desc = { model: ['色は物質の種類(円盤、小石、円盤風、エンベロープなど)を、明るさはその量を示します。', 'Colour shows the material (the disk, the pebbles, the wind, the envelope and so on); brightness, how much of it is there.'],
        optical: ['星の光を散乱する表層と円盤風を示します。', 'The surface and wind scatter starlight.'],
        mir: ['暖かい表層の熱放射を示します。', 'The warm surface emits thermal radiation.'],
        mm: ['赤道面に沈んだ小石の熱放射を示します。', 'Settled pebbles at the midplane emit thermal radiation.'] }[lookNow];
      return { title: j ? 'Colour and brightness' : '色と明るさ', description: desc ? desc[j] : '', units: '', min: null, max: null, rangeMode: 'none',
        items: lookNow === 'model' ? MAT.map(([, hex, , ja_, en]) => ({ label: j ? en : ja_, color: hex })) : [] };
    };
    let legendKey = '';
    const legendEvent = () => {
      const detail = legendSpec();
      // Use displayed numeric ticks, not sub-label changes of coLn or inclination during a flight. Categorical
      // swatches keep their colours in the key; sampled colours along a continuous bar do not create new narration.
      const items = lookNow === 'model' && opt.slice && opt.sliceQ === 'layers' ? detail.items : detail.items.map((item) => item.label);
      const key = JSON.stringify([detail.title, detail.description, detail.units, detail.rangeMode, items]);
      if (key !== legendKey) { legendKey = key; box.dispatchEvent(new CustomEvent('disklegend', { detail })); }
    };
    const sLabel = (i, x, y, text, anchor) => {
      if (!sLabels[i]) sLabels[i] = mkS('text', { class: 'disk-label', stroke: '#0a0d18', 'stroke-width': 3, 'stroke-opacity': 0.75, 'paint-order': 'stroke' });
      const e = sLabels[i]; e.textContent = text; e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('text-anchor', anchor || 'start');
    };
    // a point (Rs, z) of the cut faces: Rs >= 0 on the right face, along cutE[1], Rs < 0 on the left one, along cutE[0]
    // (for the 1/2 cut the two halves of one plane, Rs along basis.r)
    const sp = (Rs, z) => { const e = cutE[Rs >= 0 ? 1 : 0], a = Math.abs(Rs); return project([a * e[0], a * e[1], z * SZ]); };
    const inView = (q) => q && q[2] > zN && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < Hh;
    // a polyline in (R, z), drawn in the four quadrants of the face that the flags allow
    function pathOf(pts, quads) {
      let d = '';
      for (const [sr, sz] of quads) {
        if (!faceSeen[sr > 0 ? 1 : 0]) continue;   // (none on a face seen edge-on)
        let pen = false, qPrev = null;
        for (const [R, z] of pts) {
          const q = sp(sr * R, sz * z);
          // (cut where a point lies off the picture by more than its size, or a step spans more than half of it: close
          // up, points beside the camera are thrown far off the screen)
          if (q[2] <= zN || q[0] < -W || q[0] > 2 * W || q[1] < -Hh || q[1] > 2 * Hh) { pen = false; continue; }
          if (pen && Math.hypot(q[0] - qPrev[0], q[1] - qPrev[1]) > 0.5 * Math.max(W, Hh)) pen = false;
          d += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true; qPrev = q;
        }
      }
      return d;
    }
    const ALL = [[1, 1], [-1, 1], [1, -1], [-1, -1]], UPPER = ALL.slice(0, 2), LOWER = ALL.slice(2);
    // opacity of the face where the segment from the camera to P leaves the part cut away (P kept): hides the field
    // lines and particles behind it (the density face covers the wind as well)
    function faceAlpha(P) {
      if (sliceU < 0.82) return 0;
      const off = sliceOff();
      let lo = -Infinity, t = Infinity, exit = 1;
      cutN.forEach((n, i) => {
        const cn = cam[0] * n[0] + cam[1] * n[1] - off, pn = P[0] * n[0] + P[1] * n[1] - off;
        const v = pn - cn;
        if (Math.abs(v) < 1e-7) { if (cn <= 0) lo = Infinity; }
        else if (v > 0) lo = Math.max(lo, -cn / v);
        else if (-cn / v < t) { t = -cn / v; exit = i; }
      });
      if (!(lo < t && t > 0 && t < 1)) return 0;
      if (exit === 0 && cutA >= 0.39) return 0;   // (round 8: no face on the 1/4 cut's left plane, as facePainted)
      const C = [cam[0] + (P[0] - cam[0]) * t, cam[1] + (P[1] - cam[1]) * t, cam[2] + (P[2] - cam[2]) * t];
      const R = Math.hypot(C[0], C[1]), z = C[2] / SZ;
      // (Disk Lab v2, round 6: the density's face is clear in the tube along the axis, where no field line of the model
      // carries gas (those from inside the disk's inner edge, R_IN, are empty), as in the shader)
      if (opt.sliceQ === 'rho') return R < RB_JS - 1 && Math.abs(z) < ZB_JS - 1 && !(Math.abs(z) > zBase(MODEL.R_IN) && R < fieldRP(MODEL.R_IN, Math.abs(z))[0]) ? ss(0.82, 1, sliceU) : 0;
      const x = lnTauJS(Math.max(R, 1e-3), z), hole = ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, R);
      return (opt.sliceQ === 'layers' ? (Math.abs(z) <= zBase(R) ? 1 : 0) : ss(-6, -4.5, x)) * hole * ss(0.82, 1, sliceU);
    }
    // The cutaway opens and closes as a sweep: sliceU goes from 0 (closed) to 1 (open) in 1.5 s, as the fades do, and
    // the planes move from the camera, or SWEEP au in front of the star when the camera is farther (nothing cut), to the
    // star, eased like the flights. The start follows the camera through the flight that comes with the opening, so
    // that the camera stays in the part cut away and the cut is seen to move in all along (from a fixed start a camera
    // flying in would pass the planes, and the cut would vanish until they passed it again). The lines
    // and labels on the faces, drawn for the planes through the star, show only at the end of the sweep. One plane faces
    // the camera; the other is turned from it toward the right by 2 cutA (0 for the 1/2 cut, 90 degrees for the 1/4 cut:
    // the quarter in front on the right cut away, its right face seen face-on and the other along the line of sight);
    // it turns over 0.9 s when the cut changes while open. cutN: the planes' normals, cutE: the faces' directions from
    // the axis (left, right), faceSeen: whether a face is seen (not edge-on), for this frame.
    // (Disk Lab v2: the 1/4 cut's wedge is turned by CUT_TURN about the axis, toward the camera's side, so that the camera
    // stays well inside the part cut away and the left face shows a little instead of edge-on; cutFn, cutFr: the turned
    // frame, given to the shader as uSliceN, uSliceR. The 1/2 cut is not turned; the turn follows the cut's angle.
    // Round 7: 10 -> 6 degrees, the owner's "the left face shows a little too much"; tried 5, 6, 7 and 10 at the dead
    // zone's place: at 6 the left face is a narrow band that still shows its dead zone and accretion layers.)
    const SWEEP = RB_JS, CUT_A = { half: 0, quarter: Math.PI / 4 }, CUT_TURN = -6.0 * Math.PI / 180;
    let sliceU = opt.slice ? 1 : 0, annAmp = opt.ann ? 1 : 0;   // annAmp: the annotations' fade (0.4 s)
    let cutA = CUT_A[opt.cut], cutN = [[1, 0, 0], [1, 0, 0]], cutE = [[0, -1, 0], [0, 1, 0]], faceSeen = [true, true];
    let cutFn = [0, 1, 0], cutFr = [1, 0, 0];
    function cutFrame() {
      const tq = CUT_TURN * (cutA / CUT_A.quarter), ct = Math.cos(tq), st = Math.sin(tq), n0 = basis.n, r0 = basis.r;
      const n = cutFn = [ct * n0[0] + st * r0[0], ct * n0[1] + st * r0[1], 0], r = cutFr = [ct * r0[0] - st * n0[0], ct * r0[1] - st * n0[1], 0];
      const c = Math.cos(2 * cutA), s = Math.sin(2 * cutA);
      cutN = [[c * n[0] + s * r[0], c * n[1] + s * r[1], 0], [n[0], n[1], 0]];
      cutE = [[s * n[0] - c * r[0], s * n[1] - c * r[1], 0], [r[0], r[1], 0]];
      // (the turned plane, seen more and more edge-on as it turns toward the line of sight)
      // (round 8: the 1/4 cut's left plane has no face, so nothing is drawn on it either)
      faceSeen = [cutA < 0.39 && Math.abs(cutN[0][0] * n0[0] + cutN[0][1] * n0[1]) > 0.2, true];
    }
    // A change of look dips the exposure for 0.6 s and takes effect at its darkest (lookNow), so the picture never
    // jumps; the model's own drawings (field lines, wind tracers, the envelope's streamlines) fade out in the observed
    // looks (fieldAmp, which also fades the field lines' toggle).
    let lookNow = 'model', lookT0 = -1e9, fieldAmp = 1;   // (round 9: an observed look switched to as any, once FULL is warm)
    // Other fades (in real time, as the others): the components gas, surface, pebbles and wind (compAmp, 0.6 s; uComp),
    // the model's drawings of the envelope between looks (modelAmp, 0.4 s), the scale bar when it changes its length
    // (the old bar fades out as the new one fades in, 0.25 s; both are true to scale)
    const COMP_BITS = [1, 2, 4, 8], compAmp = COMP_BITS.map((b) => (opt.mode & b ? 1 : 0));
    let jetAmp = opt.mode & 64 ? 1 : 0;   // (round 8: the jet's fade)
    let fxAmp = opt.fx;   // (round 8: opt.fx as it fades, see opt.fx)
    let modelAmp = opt.look === 'model' ? 1 : 0, sbLb = 0, sbOld = 0, sbT = -1e9, msAmp = opt.ms ? 1 : 0, asymAmp = opt.asym ? 1 : 0, marksAmp = opt.marks && (opt.mode & 1) ? 1 : 0;
    // (Disk Lab v2: the flow markers belonged to the field lines, as their option on the page, and were not drawn while the
    // lines were off; round 8, the owner: "an option of the gas": drawn while the gas is shown)
    const marksOn = () => opt.marks && (opt.mode & 1);
    const toward = (cur, want, dt, secs) => (reduce ? want : want > cur ? Math.min(want, cur + dt / secs) : Math.max(want, cur - dt / secs));
    // Disk Lab v2: the model's clock follows the radius in view, as 1/Omega_K there: k = (r_view / CLOCK.R)^(3/2), at most
    // 1, with r_view = |T| (+) CLOCK.K d (T the point looked at, d the camera's distance from it, both as the camera flies;
    // CLOCK.K d is about the half-height of the view at T). CLOCK.R = 30 au is what the whole disk's view frames (d = 90 au,
    // looking at the star), where the clock runs as before (x1). Every view then shows the gas it frames turning as the
    // whole view shows the outer disk turning; the inner parts of a view turn faster, as in the whole view. Zoomed in to
    // the snow line (9 au) the clock runs at 1/32, next to the star (0.15 au) at about 1/15000; wider views than the
    // whole disk keep x1 (the envelope's infall has its own pace). (It replaces the engine's slowing within 0.3 au of the
    // star, (d / 2 au)^1.5. A choice for the picture; the state's time is the model's.)
    const CLOCK = { R: 30, K: 1 / 3 };
    const clockK = () => {
      if (!cam) return 1;
      const rv = Math.hypot(Math.hypot(camT[0], camT[1], camT[2]), CLOCK.K * camD);
      return Math.min(1, Math.pow(rv / CLOCK.R, 1.5));
    };
    let magFrame = { vis: 0, ax: [0, 0, 1], e1: [1, 0, 0] };
    // the accretion layers (see ACC): their strengths and inflow speeds (upper, lower) for the wind's asymmetry as it
    // fades: a symmetric field accretes on both sides, an aligned one on the lower side only, twice as fast
    const asymSm = () => asymAmp * asymAmp * (3 - 2 * asymAmp);
    const accW = () => [1 - asymSm(), 1];
    const accK = () => [ACC.K_SYM, ACC.K_SYM + (ACC.K_ASYM - ACC.K_SYM) * asymSm()];
    // the CO line's moment-1 colours span +-12 km/s times the sine of the inclination (at least 2 km/s: seen face-on only
    // the wind's and the inflow's motions remain along the line of sight)
    // moment 1's range: the line-of-sight speeds for the inclination, and faster closer in (the gas the camera frames
    // turns faster: up to twice as fast, as the square root of 30 au over the distance)
    const coRange = () => Math.max(2, 12 * Math.sqrt(Math.max(0, 1 - basis.f[2] * basis.f[2]))) * Math.min(2, Math.max(1, Math.sqrt(30 / camD)));
    const fadesDone = () => !clumps.some((c) => c.gone && c.amp > 0) && jetAmp === (opt.mode & 64 ? 1 : 0) && fxAmp === opt.fx && COMP_BITS.every((b, i) => compAmp[i] === (opt.mode & b ? 1 : 0)) && modelAmp === (lookNow === 'model' ? 1 : 0) && performance.now() - sbT >= 250 && msAmp === (opt.ms ? 1 : 0) && asymAmp === (opt.asym ? 1 : 0) && marksAmp === (marksOn() ? 1 : 0) && wavesAmp === (opt.waves ? 1 : 0);
    const lookDip = () => { const u = (performance.now() - lookT0) / 600; return reduce || u >= 1 || u <= 0 ? 1 : 1 - 0.92 * Math.sin(Math.PI * u); };
    const sliceOff = () => { const u = sliceU; return (1 - u * u * (3 - 2 * u)) * Math.min(Math.max(Math.hypot(cam[0], cam[1]), 2), SWEEP); };
    // the part of space kept by the cutaway: outside the part between the planes toward the camera
    const kept = (P) => {
      if (sliceU <= 0) return true;
      const off = sliceOff();
      return !(P[0] * cutN[0][0] + P[1] * cutN[0][1] > off && P[0] * cutN[1][0] + P[1] * cutN[1][1] > off);
    };
    function drawSlice() {
      sliceG.setAttribute('opacity', (ss(0.82, 1, sliceU) * annAmp).toFixed(3));
      if (sliceU <= 0) { for (const k in sP) sP[k].setAttribute('d', ''); sLabels.forEach((e) => { e.textContent = ''; }); drawCbar('', 0); return; }
      const ja_ = ja(), g = buildSlice(opt.sliceQ);
      let li = 0;
      const lines = (ls) => ls.map((c) => (Array.isArray(c) ? pathOf(c, ALL) : c.lr != null && anyWake() ? wakeContours(c.lr) : pathOf(c.pts, c.quads))).join('');
      sP.contour.setAttribute('d', lines(g.lines));
      sP.tau1.setAttribute('d', pathOf(g.tau1, ALL));
      sP.ice.setAttribute('d', pathOf(g.ice, ALL)); sP.iceHalo.setAttribute('d', sP.ice.getAttribute('d'));
      // the pebble layer: rock inside the snow line, ice outside, thick where it piles up (just outside the snow line,
      // and at the planet's pressure maximum); broken across the planet's gap
      const spans = (R0, R1, ok) => { const out = []; let a = null; for (let R = R0; R <= R1 + 1e-9; R += 0.01) { if (ok(R)) { if (a === null) a = R; } else if (a !== null) { out.push([a, R]); a = null; } } if (a !== null) out.push([a, R1]); return out; };
      const segs = (list) => list.map(([a, b]) => pathOf([[a, 0], [b, 0]], UPPER)).join('');
      const peb = (R) => pebbleAll(R) * pebEdge(R);   // (round 8: ending at the pebbles' own edge, MODEL.R_PEB)
      // (round 6: with the pebbles shown only, as the page's key has it)
      const pebOn = !!(opt.mode & 4);
      sP.rock.setAttribute('d', pebOn ? segs(spans(MODEL.R_IN, rSn, (R) => peb(R) > 0.3)) : '');
      sP.icy.setAttribute('d', pebOn ? segs(spans(rSn, 31, (R) => peb(R) > 0.3)) : '');
      sP.pile.setAttribute('d', pebOn ? segs([[rSn * 1.02, rSn * 1.3], ...spans(Math.max(rSn, 2), 31, (R) => peb(R) > 1.8)]) : '');
      // the planet's orbit, where it crosses the plane
      let dPl = '', dHill = '';
      const circ = (x, y, r) => 'M' + (x - r).toFixed(1) + ' ' + y.toFixed(1) + 'a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (2 * r).toFixed(1) + ' 0a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (-2 * r).toFixed(1) + ' 0';
      for (const p of planets) {
        if (p.amp <= 0.5) continue;
        for (const sr of [-1, 1]) {
          if (!faceSeen[sr > 0 ? 1 : 0]) continue;
          const c = sp(sr * p.a, 0);
          if (c[2] <= zN) continue;
          dPl += circ(c[0], c[1], 3.5);
          const rh = Math.hypot(...[0, 1].map((k) => sp(sr * (p.a + hillOf(p)), 0)[k] - c[k]));   // (the Hill radius along the face, in px)
          if (rh > 8) dHill += circ(c[0], c[1], rh);
        }
      }
      sP.planet.setAttribute('d', dPl); sP.hill.setAttribute('d', dHill);
      // field lines in the plane, and arrows for the gas velocity in the plane, (v_R, v_z) = v_K(r0) F (dxi/dchi, 1),
      // spaced along the lines on the screen (round 8: as long as the arrows in the volume, arrowLen; 0.6 px per km/s
      // before); fewer below with the wind's asymmetry. (Round 8: with the gas and the flow arrows, not with the lines)
      let dF = '', dA = '';
      shapePlaneLines(Math.round(ASYM_F_JS * asymSm() * 100) / 100);
      if (showField) for (const L of planeLines) dF += pathOf(L.up.pts, UPPER) + pathOf(L.low.pts, LOWER);
      if ((opt.mode & 8) && marksOn()) for (const L0 of planeLines) for (const [sr, sz] of ALL) {
        if (!faceSeen[sr > 0 ? 1 : 0]) continue;
        let acc = 0, prev = null;
        const gap = sz > 0 || !opt.asym ? 64 : 110, L = sz > 0 ? L0.up : L0.low;
        for (let i = 0; i + 1 < L.pts.length; i++) {
          const [R, h, chi] = L.pts[i];
          const q = sp(sr * R, sz * h), q2 = sp(sr * L.pts[i + 1][0], sz * L.pts[i + 1][1]);
          if (q[2] <= zN || q2[2] <= zN) { prev = null; continue; }
          if (prev) acc += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
          prev = q;
          if (chi < 0.05 || acc < gap || !inView(q)) continue;
          acc = 0;
          const f = tabS(chi), v = tabF(L.T.F, f) * Math.hypot(1, tabF(L.T.XIP, f)) * vK(L.r0);
          const ux = q2[0] - q[0], uy = q2[1] - q[1], ul = Math.hypot(ux, uy) || 1, len = arrowLen(v);
          const ex = q[0] + ux / ul * len, ey = q[1] + uy / ul * len, hx = ux / ul * ARROW.HEAD, hy = uy / ul * ARROW.HEAD;
          dA += 'M' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
              + 'M' + (ex - hx - hy * 0.7).toFixed(1) + ' ' + (ey - hy + hx * 0.7).toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
              + 'L' + (ex - hx + hy * 0.7).toFixed(1) + ' ' + (ey - hy - hx * 0.7).toFixed(1);
        }
      }
      sP.flines.setAttribute('d', dF);
      sP.arrows.setAttribute('d', dA);
      // (the dead zone's top: the regions' face shows it as a boundary of colours; round 6, no longer a line on the others)
      sP.dead.setAttribute('d', '');
      // the accretion's inflow along its layer(s), on the side(s) that accrete: arrows toward the star (round 8: arrowLen, as
      // the others; 6 px per km/s before; the inflow is a few km/s, ten times slower than the wind), with the gas
      let dAcc = '';
      const aw = accW(), ak = accK();
      if ((opt.mode & 1) && marksOn()) for (const R of [0.55, 0.8, 1.15, 1.65, 2.4, 3.5, 5, 7.5, 11, 16]) for (const [sr, sz] of ALL) {
        if (!faceSeen[sr > 0 ? 1 : 0]) continue;
        if ((sz > 0 ? aw[0] : aw[1]) < 0.5 || accAmpJS(R) < 0.5) continue;
        const v = (sz > 0 ? ak[0] : ak[1]) * MODEL.H0 * Math.pow(R, 0.25) * vK(R), len = arrowLen(v);
        const z = (sz > 0 ? zAccHJS(R) : zAccLowJS(R, asymSm())) * Hof(R), q = sp(sr * R, sz * z), q2 = sp(sr * R * 0.97, sz * z);
        if (q[2] <= zN || q2[2] <= zN || !inView(q)) continue;
        const ux = q2[0] - q[0], uy = q2[1] - q[1], ul = Math.hypot(ux, uy) || 1;
        const ex = q[0] + ux / ul * len, ey = q[1] + uy / ul * len, hx = ux / ul * ARROW.HEAD, hy = uy / ul * ARROW.HEAD;
        dAcc += 'M' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
            + 'M' + (ex - hx - hy * 0.7).toFixed(1) + ' ' + (ey - hy + hx * 0.7).toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
            + 'L' + (ex - hx + hy * 0.7).toFixed(1) + ' ' + (ey - hy - hx * 0.7).toFixed(1);
      }
      // the legend (top left), and the keys of the velocity arrows (bottom right). (Disk Lab v2, round 6: no names on the
      // face's lines and regions any more, the owner's "the labels on the cut say poorly which line they mean, and the
      // contours' values sit in regions too narrow to tell": the page's key names the lines, and the legend the colours,
      // with the magnetosphere's two regions close to the star)
      li = drawCbar(opt.sliceQ, li);
      const boxes = [[0, 0, CBW + 30, 52]], textW = (t) => [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 11 : 6.3), 0);
      const place = (x, y, t, anchor) => {
        const w = textW(t), x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, b = [x0 - 2, y - 11, x0 + w + 2, y + 3];
        if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > Hh - 24 || boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
        boxes.push(b); sLabel(li++, x, y, t, anchor);
        return true;
      };
      // (round 8) one key for both kinds of arrows, as their length is the logarithm of the speed: 1, 10 and 100 km/s
      if (dA || dAcc) {
        const y0 = Hh - 18;
        let kd = '', x = W - 14;
        for (const v of [100, 10, 1]) {
          const l = arrowLen(v), x1 = x - l;
          kd += 'M' + x1.toFixed(1) + ' ' + y0 + 'L' + x.toFixed(1) + ' ' + y0 + 'M' + (x - ARROW.HEAD).toFixed(1) + ' ' + (y0 - 2.3) + 'L' + x.toFixed(1) + ' ' + y0 + 'L' + (x - ARROW.HEAD).toFixed(1) + ' ' + (y0 + 2.3);
          x = x1 - 8;
        }
        sP.arrows.setAttribute('d', dA + kd);
        boxes.push([x - 70, y0 - 12, W, Hh]); sLabel(li++, x - 2, y0 + 4, '1, 10, 100 km/s', 'end');
      }
      sP.acc.setAttribute('d', dAcc);
      // (the 1/4 cut: through its face, below the disk's thin layer, lies the space under the disk behind it, dark, beside
      // the left half of the disk left whole: named, as it reads as a hole; a name of what is seen past the face, not on it)
      sP.edge.setAttribute('d', '');
      if (opt.cut === 'quarter' && sliceU >= 0.82) {
        const sz = cam[2] >= 0 ? -1 : 1, qL = sp(0.3 * camD, sz * 0.14 * camD);
        if (inView(qL)) place(qL[0], qL[1], sz < 0 ? (ja_ ? '円盤の下の空間(切り口ごしに)' : 'the space under the disk, through the cut') : (ja_ ? '円盤の上の空間(切り口ごしに)' : 'the space over the disk, through the cut'), 'middle');
      }
      // close to the star, on every face: the X-points at the truncation radius, marked (the closed magnetosphere and the
      // curtains' cross-section are painted, and named in the legend)
      let dXp = '';
      if (XPOINT_MARK && magFrame.vis > 0.5) {
        for (const sr of [1, -1]) {
          const qx = sp(sr * MAG.RT, 0);
          if (!faceSeen[sr > 0 ? 1 : 0] || qx[2] <= zN || !inView(qx)) continue;
          dXp += 'M' + (qx[0] - 5) + ' ' + (qx[1] - 5) + 'L' + (qx[0] + 5) + ' ' + (qx[1] + 5) + 'M' + (qx[0] - 5) + ' ' + (qx[1] + 5) + 'L' + (qx[0] + 5) + ' ' + (qx[1] - 5);
        }
      }
      sP.xpt.setAttribute('d', dXp);
      for (let i = li; i < sLabels.length; i++) sLabels[i].textContent = '';
    }
    // (round 7) a picture saved larger than the screen: snapK multiplies the canvas's pixels for its time (see
    // diskSnapshot), and snapBands splits each frame's volume into that many bands, each sent to the GPU on its own, so that
    // no single piece of GPU work takes seconds (the system stops it, and the WebGL context is lost)
    let snapK = 1, snapBands = 1;
    function resize() {
      // the height follows data-aspect when given (the canvas's default size would otherwise set it)
      W = box.clientWidth; Hh = box.dataset.aspect ? Math.round(W * Number(box.dataset.aspect)) : (box.clientHeight || Math.round(W * 0.62));
      box.style.height = Hh + 'px';
      toastFit();
      if (lost) return;   // (without a context: the static picture shows, and the canvas is sized when the context is back)
      // the canvas at the screen's pixels (the cut face is drawn there, faceT), the volume at the render scale (accT,
      // rW x rH, upsampled by SHOW_FS)
      const dprS = Math.min(window.devicePixelRatio || 1, 2) * snapK, dpr = dprS * opt.scale;
      canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
      const cw = Math.max(1, Math.round(W * dprS)), ch = Math.max(1, Math.round(Hh * dprS));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      rW = Math.max(1, Math.round(W * dpr)); rH = Math.max(1, Math.round(Hh * dpr));
      overlay.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      diskTarget();
      if (accT) { gl.deleteFramebuffer(accT.fb); gl.deleteTexture(accT.tex); }
      accT = target(rW, rH, gl.RGBA16F, gl.CLAMP_TO_EDGE); glErr('resize ' + cw + 'x' + ch);
      accFor = [cw, ch];
      if (faceT && (faceT.w !== cw || faceT.h !== ch)) { for (const t of [faceT, faceA]) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); } faceT = faceA = null; for (const u of [gl.TEXTURE11, gl.TEXTURE12]) { gl.activeTexture(u); gl.bindTexture(gl.TEXTURE_2D, noFace); } }
      accN = 0;   // (the new target is empty: a still starts over, else its next frame would be averaged with nothing)
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, accT.tex);
      if (!snapping) drawOut();   // (round 9: a snapshot draws its own frames, at the scale it plans, in its bands)
    }
    // Disk Lab v2: a new render scale without new targets or a frame drawn at once (each cost 20-100 ms of script, and
    // the page steps the scale with the frame time, also while the view moves). The volume is drawn into the lower left
    // rW x rH of accT, which grows (only) to the largest picture asked for at this canvas size; the display reads that
    // part (uAccPart). The next animation frame draws.
    let accFor = null;
    function rescale() {
      cancelJob();   // (round 9: a frame being drawn in bands at the scale before is left; round 10a: its kicks' queries with it)
      if (lost || !accT || !accFor || accFor[0] !== canvas.width || accFor[1] !== canvas.height) { resize(); return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * snapK * opt.scale;
      rW = Math.max(1, Math.round(W * dpr)); rH = Math.max(1, Math.round(Hh * dpr));
      if (rW > accT.w || rH > accT.h) {
        gl.deleteFramebuffer(accT.fb); gl.deleteTexture(accT.tex);
        accT = target(Math.max(rW, accT.w), Math.max(rH, accT.h), gl.RGBA16F, gl.CLAMP_TO_EDGE); glErr('rescale ' + accT.w + 'x' + accT.h);
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, accT.tex);
      }
      accN = 0; dirty = true;
    }
    // Still pictures are refined: while nothing that the volume depends on changes (paused, and no flight, fade or sweep
    // under way), each frame is drawn with a new offset of the ray within the pixel and of the march's jitter (low-
    // discrepancy sequences) and averaged with the frames before it, up to ACC_MAX, so that the grain of the march, the
    // banding of its steps and the jagged edges fade out; the maps are not redrawn meanwhile. Any change starts over at
    // once. A snapshot averages ACC_SNAP frames.
    const ACC_MAX = 16, ACC_SNAP = 12;
    const TIME_MAX = 1e6;   // the model's clock from outside, at most (s: 12 days at x1)
    // The automatic exposure (the model's look, the camera within AE.D of the star). Close to the star the inner disk's lit
    // surface fills the picture and the stretch runs into white (a mean level of 200 or more, a third of the pixels blown
    // out at 0.25 au, at a low angle more). Each frame is measured on the GPU (AE_FS, the volume's share only) and read
    // back a frame or two later without waiting for it (a fence), and the exposure is brought down from 1 until the mean
    // display level is at most AE.TARGET and no more than AE.BLOWN of the picture is blown out; it never rises above 1,
    // so the far views and the darker close ones are as before. It moves only when off by more than AE.DEAD (in ln of the
    // level), and then eased over 0.15 s, so that a still picture settles and refines; it gives up after AE.TRIES moves for
    // one view. It holds through an outburst (whose brightening is the point) and a change of look (the dip). With reduced
    // motion it is found at once (blocking reads, up to five frames). While the view moves (a flight, a drag, a touch) it
    // follows: every frame that can be measured is, whatever the view's key by the time it is read, and the step is a
    // plain one from the exposure of the frame measured (the bounds and the count of tries belong to one view).
    const AE = { D: 12, TARGET: 0.46, BLOWN: 0.02, DEAD: 0.06, GAIN: 3, STEP: 1.2, MIN: 0.01, TRIES: 8 };
    const aeT = target(AE_W, AE_H, gl.RGBA8, gl.CLAMP_TO_EDGE), aeBuf = gl.createBuffer(), aePx = new Uint8Array(AE_W * AE_H * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, aeBuf); gl.bufferData(gl.PIXEL_PACK_BUFFER, AE_W * AE_H * 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let aeLn = 0, aeGoal = 0, aeSync = null, aeLnUsed = 0, aeFresh = true, aeTries = 0, aeTrack = false, aeKindUsed = '', aeSeen = null;
    let aeLo = -Infinity, aeHi = Infinity;   // ln of exposures found too dark and too bright for this view (bisection)
    let aeGen = 0, aeGenUsed = 0, aeKey = '';  // the view's count, that of the frame being measured (an older one is not used),
                                               // and the view, coarsely (the clock running does not make a new one)
    const aeOn = () => lookNow === 'model' && !!cam && Math.hypot(cam[0], cam[1], cam[2]) < AE.D;
    const aeHeld = () => !!burst || lookDip() < 1;
    // (the view moving: a flight, a drag, a touch on the picture)
    const viewMoving = () => !!flyV || !!flyT || dragging || touching;
    function aePass() {   // the measurement of the frame in accT, into aeT
      firstUse('ae');
      gl.bindFramebuffer(gl.FRAMEBUFFER, aeT.fb); gl.viewport(0, 0, AE_W, AE_H);
      gl.useProgram(progAE); gl.uniform2f(uAeSrc, rW, rH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // A new goal for ln of the exposure from the cells read back (of a frame drawn at lnUsed); true when it moved. Too
    // bright: blown out over AE.BLOWN, or the mean level over AE.TARGET; too dark: under it, with a margin from the blown
    // limit, and the exposure under 1. A step is a part of the Newton step (the display level moves about a fifth as much
    // as the exposure, in ln; blown pixels count as ln 1.1 per percent over), at most AE.STEP; between exposures known to
    // be too bright and too dark for this view it goes halfway, and it settles on the darker side when they are close.
    function aeAim(px, lnUsed, track) {
      let s = 0, b = 0, w = 0;
      for (let i = 0; i < px.length; i += 4) { s += px[i]; b += px[i + 1]; w += px[i + 2]; }
      // (round 10a, dev.6, for checks: what the last measurement saw, diskLoops().ae.seen: the mean level and the blown share of
      // the volume's part, and that part's share of the picture)
      aeSeen = { m: w > 0 ? Math.round(1000 * s / w) / 1000 : null, blown: w > 0 ? Math.round(10000 * b / w) / 10000 : null, vol: Math.round(1000 * w / (255 * AE_W * AE_H)) / 1000, ln: Math.round(1000 * lnUsed) / 1000 };
      if (!track && aeTries >= AE.TRIES) { aeFresh = true; return false; }
      // (nothing to measure: cut faces or the star cover nearly all of the picture; back to 1)
      if (w < 0.05 * 255 * AE_W * AE_H) { aeFresh = true; if (lnUsed === 0) return false; aeGoal = 0; return true; }
      const m = s / w, blown = b / w, e = Math.log(Math.max(m, 1e-3) / AE.TARGET);
      const bright = blown > AE.BLOWN || e > AE.DEAD, dark = !bright && lnUsed < 0 && e < -AE.DEAD && blown < 0.3 * AE.BLOWN;
      if (!bright && !dark) { aeFresh = true; return false; }
      // (following a moving view: a plain step from the frame measured)
      if (track) {
        aeGoal = Math.min(0, Math.max(Math.log(AE.MIN), lnUsed + (bright ? -1 : 1) * Math.min(AE.STEP, AE.GAIN * (bright ? Math.max(e, 0) + 10 * Math.max(blown - AE.BLOWN, 0) : -e))));
        aeFresh = false;
        return true;
      }
      if (bright) aeHi = Math.min(aeHi, lnUsed); else aeLo = Math.max(aeLo, lnUsed);
      let goal = lnUsed + (bright ? -1 : 1) * Math.min(AE.STEP, AE.GAIN * (bright ? Math.max(e, 0) + 10 * Math.max(blown - AE.BLOWN, 0) : -e));
      if (aeHi - aeLo < 0.1) goal = aeLo;
      else if (goal <= aeLo || goal >= aeHi) goal = 0.5 * (aeLo + aeHi);
      goal = Math.min(0, Math.max(Math.log(AE.MIN), goal));
      aeTries++;
      if (Math.abs(goal - lnUsed) < 1e-3) { aeFresh = true; return false; }
      aeGoal = goal; aeFresh = false;
      return true;
    }
    // The CO line's range for the channel map and moment 0 (the measured frames are shared with the exposure): raised from
    // its base (CO_TB, CO_M0) until at most 2% of the map is at the top of the colours (close to the star the whole map
    // would be), lowered back toward the base when under 0.3%; in steps of a factor 2, bisecting between ranges found too
    // narrow and too wide, settling on the wider; at most 30 times the base. The colour bar's labels follow. The range is
    // searched for a view (coKey: the view, the look, the moment or channel, not the components) and held when only the
    // components change (coHold), so that maps with and without a component are compared at one range; the colour bar
    // says which ("範囲:自動" / "範囲:固定").
    let coLn = 0, coGoal = 0, coFresh = true, coTries = 0, coLo = -Infinity, coHi = Infinity, coKey = '', coHold = false, coModeSeen = -1;
    // A saved range is applied after its camera/look/fades settle. Its calibrated value survives diskSettle's second
    // round for that view; a new view or channel resumes the ordinary automatic search. CO measurements have their
    // own generation, so a stale line-map reading cannot change the range or the model's exposure after a restore.
    let coPending = null, coSavedKey = '', coGen = 0, coGenUsed = 0;
    const coResume = () => { coPending = null; coSavedKey = ''; coHold = false; coTries = 0; coLo = -Infinity; coHi = Infinity; coFresh = false; coGen++; };
    const coOn = () => lookNow === 'co' && opt.coMode !== 'm1';
    function coAim(px, lnUsed) {
      let b = 0, w = 0;
      for (let i = 0; i < px.length; i += 4) { b += px[i + 1]; w += px[i + 2]; }
      if (coHold || coPending || coSavedKey === coKey || coTries >= AE.TRIES || w <= 0) { coFresh = true; return false; }
      const blown = b / w, narrow = blown > 0.02, wide = !narrow && blown < 0.003 && lnUsed > 0;
      if (!narrow && !wide) { coFresh = true; return false; }
      if (narrow) coLo = Math.max(coLo, lnUsed); else coHi = Math.min(coHi, lnUsed);
      let goal = lnUsed + (narrow ? 0.7 : -0.7);
      if (coHi - coLo < 0.1) goal = coHi;
      else if (goal <= coLo || goal >= coHi) goal = 0.5 * (coLo + coHi);
      goal = Math.max(0, Math.min(Math.log(30), isFinite(goal) ? goal : 0));
      coTries++;
      if (Math.abs(goal - lnUsed) < 1e-3) { coFresh = true; return false; }
      coGoal = goal; coFresh = false;
      return true;
    }
    // (round 10a) THE MARCH IN KICKS (DESIGN.md, section 23, 光線を区切って進める; FS, its uSplit). In the continuum's looks
    // (the visible and the mid-infrared: their slowest rays some 720 steps, 55 ms on the M1 Max) a band of the volume is drawn
    // in kicks: each advances every ray of the band by at most kickK steps' worth of work, the rays' state kept in a float
    // array of four layers (16 numbers a pixel: 64 bytes, the most an Apple GPU's tile holds for the targets of one draw; read
    // through one sampler, of the 16 a fragment shader may use, which FULL nearly fills: box.diskSamplers), two sets read and
    // drawn into in turn. A ray done is written into the other set in the next kick and then left; each kick asks the GPU
    // whether it drew any pixel (an occlusion query, read once the piece's fence has passed): one that drew none says the
    // band is done in both sets, and the band's picture is drawn from the state into the volume's target (with the still's
    // averaging) in the next piece, before the next band's kicks. A piece (one fence: what the guard, the band sizing and the
    // duty count) is a run of a band's kicks, as many as the kind's bands took lately (needOf) with the two that see it done;
    // a band not done goes on in the next piece (see kickMax). Each kick is flushed on its own (a command buffer each). The
    // state holds a band's rows: at most SPLIT.MB a set (8 MB: 168 rows at a width of 780, all of a phone's frame at its
    // usual scales), the band's rows at most that. Not for a measurement drawn whole (diskBench, diskRayProbe), the warm,
    // reduced motion (its frames drawn at once, with no frames after to see a band done), the gas line in the full tier (its
    // passes of three groups, bounded apart: CO_IT; dev.6: in the cheaper tier, a group a pass, in kicks: see coRun) nor the
    // model's look (rays of 150 to 300 shorter steps). data-split="0" (the page's ?split=0): drawn whole, as before, to
    // compare; data-kick (?kick=N): kickK; box.diskSplit
    const SPLIT = { UNIT: 20, MB: 8, K: 32, N0: 32, RING: 16 };
    let splitOn = box.dataset.split !== '0' && fbFloat, kickK = Number(box.dataset.kick) > 0 ? Math.min(4096, Math.max(4, Math.round(Number(box.dataset.kick)))) : SPLIT.K;
    let kickEach = false, testT = null, stT = null, warmS = null, testRows = 0, testTm = 0, testLate = false;   // (testRows: diskSplitTest's bands at most so many rows)
    const kickNeed = {};   // (per kind: the kicks its last bands took)
    const splitBroken = {};   // (per kind: its march in kicks given more kicks than its rays can need, see kickMax: a bug)
    // (per kind: what a band's first kick cost a pixel, ms, its last few: the bands' rows and the pieces' kicks are sized from it,
    // see splitStep; dropped at a jump, as the guard's measures are)
    // (and the most rows a band of the kind had when its first kicks were measured; and the rows of its last band, kept from frame
    // to frame. KICK_MS_MIN: a first piece measured only from so many ms: the fences are looked at every 8 ms or so, and a piece
    // of a kick or two (1 to 3 ms) read as 8 to 16, its kick's cost overestimated several times, the bands kept small: four on a
    // phone's frame where one would do, each paying its slowest ray, 3 times the frame drawn whole)
    // (round 10a, optimizing: kickT, per kind, what a band's first kicks took (t, ms: the piece's time over its kicks) at how many
    // rows, the last four, measured at one size of the volume (w x h) and one work of a kick (K) only, and the most rows so
    // measured (top). A kick of R rows is predicted at most min over them of t x max(1, R / rows): never cheaper than one
    // measured at more rows, and in proportion beyond one at fewer (a kick's time is a part of its own, the slowest rays' steps
    // in turn, and a part with its pixels: both bounds hold). Any other size, look, march or work of a kick has no measure
    // (kickReset): its first band is the least, four kicks, as at a first use. Round 10a's checks: (1) the rows changed at most
    // by half a band from a time a kick took, the work of a kick raised to 1024 at a small still, a still refined to scale 1 sent
    // a kick of 639 ms; (2) the time over the band's pixels times the work, from small bands whose kicks were mostly their own
    // part, refused every larger band and lowered the work to 16: a frame of 17 bands, 330 to 400 s)
    const kickT = {}, kickRowsOf = {}, KICK_MS_MIN = 8, KICK_RISE = 2;
    // (round 10a, dev.6: the kicks of a band's first piece where nothing is measured: 4, and 1 within a guarded device's budget
    // (70 ms, or less: the checks' ?gpux) for the first band of a kind after a jump or a switch of look (kickResetAll; kickFresh
    // until a band is done; none of its bands drawn since: kickRowsOf), not after a new size alone: a moving view's scale changes
    // made pieces of one kick there, their fences mostly the time to see them, and the check of a moving view on that frame read
    // a kick of 61 ms (times 6) against 47 to 55 before. The first piece after a jump to the visible look, in the frame as WebKit
    // on a GPU six times slower, took 8 ms
    // with 4 kicks, 1 to 2 with 1 (times 6: 49 to 51, 7 to 12). On the M1 Max (Chrome, ?guard=70, the jump's first band of 8 rows)
    // 5 to 7 ms with 4 kicks, 2.5 to 3.8 with 2 and 2.0 to 2.6 with 1; with 2 kicks over 4 rows no less than over 8 (a kick's time
    // its slowest rays', not its pixels'), so the rows stay. Not after: a kind whose pieces are too short to be measured
    // (KICK_MS_MIN) has no measure, and 1 kick for every band's first piece cost the moving view in the visible look a piece more a
    // frame, 8.6 to 6.2 pictures a second afar on the phone's frame. box.diskSplit({ first, least }), for a test: those kicks and
    // the least band's rows (0: BAND_ROWS))
    let kickFirstSet = 0, kickLeast = 0, kickFresh = false;
    const kickFirst = (drawn) => kickFirstSet || (!drawn && kickFresh && gBudget > 0 && gBudget <= 70 ? 1 : 4);
    const kickMs = (key, K) => { const m = kickT[key]; return m && m.w === rW && m.h === rH && m.K === K && m.ts.length ? m.ts : null; };
    // (the predicted bound of a kick of R rows, ms; 0 where not measured at this size and work)
    const kickAt = (key, K, R) => { const ts = kickMs(key, K); return ts ? Math.min(...ts.map((x) => x.t * Math.max(1, R / x.rows))) : 0; };
    // (the most rows whose kick that bound keeps under ms; 0 where none does)
    const kickRowsFor = (key, K, ms) => { const ts = kickMs(key, K); return ts ? Math.max(0, ...ts.map((x) => (x.t <= ms ? Math.floor(x.rows * ms / x.t) : 0))) : 0; };
    // (round 10a, the CPU's part: a flush after each piece, one command buffer of at most the aim, as a band drawn whole had;
    // each kick flushed on its own (box.diskSplit({ flush: 'kick' })) cost the GPU nothing measurable on the M1 Max either way)
    let kickFlush = 'piece';
    // (round 10a, the work of a kick by kind, adapted: kickK is where a kind starts (the page's: 32 on a phone, 48 else). A kind
    // whose band, measured at this size and work, covers the frame (or the state's rows) with its first kicks well under half the
    // aim (KICK_UP of it) takes twice the work a kick, up to KICK_MAX, and is measured anew from the least band (kickReset, the
    // work kept); a kick predicted over half the aim even at the least band, half, never under kickK (the work the march in kicks
    // was checked at; with 16 a frame of 17 bands differed from the rays drawn whole in a band's worth of pixels, not yet
    // understood; over it with more rows, the band is made smaller instead: the kicks a frame takes are much the same either
    // way, for a kick of a given time). The work
    // goes back to kickK at any change of the volume's size or scale, the look or the march (the coordinator, after the 639 ms
    // kick: it grows again only from kicks measured at the size drawn). The calls a kick makes (each a message to the GPU's
    // process in WebKit) and what a kick costs the GPU over its rays' own work (the state read and written, the march set up
    // again) are a frame's kicks over: on the M1 Max at the scales a phone's frame is drawn, a kick of 32 steps took 3 to 5 ms
    // where half the aim is 17. The picture is the same whatever the work of a kick (the rays resume exactly). Off by default
    // (the coordinator: the scheduler kept simple; kickK fixed by the device), box.diskSplit({ adapt: true }) or the page's
    // ?kadapt=1 to measure what it saves)
    const kickKOf = {}, KICK_MAX = 1024, KICK_UP = 0.3;
    let kickAdapt = false;
    const kOf = (key) => (kickAdapt && kickKOf[key]) || kickK;
    // (a kind's measures dropped: its next band the least, four kicks, as at a first use; all: its work of a kick back to kickK)
    function kickReset(key, all) { for (const m of [kickT, kickNeed, kickRowsOf]) delete m[key]; if (all) delete kickKOf[key]; }
    const kickResetAll = () => { for (const m of [kickT, kickNeed, kickRowsOf, kickKOf]) for (const key in m) delete m[key]; kickFresh = true; };
    // (the sampler's texture while no state is made: a 1 x 1 array, never drawn into)
    const stDummy = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + SPLIT.UNIT); gl.bindTexture(gl.TEXTURE_2D_ARRAY, stDummy); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, 1, 1, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE2);
    // a set of the state: an array of 4 layers of 32-bit floats, read texel by texel; its framebuffer draws into the 4 layers
    function stateSet(w, h) {
      gl.activeTexture(gl.TEXTURE2);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, w, h, 4);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const bufs = [0, 1, 2, 3].map((k) => gl.COLOR_ATTACHMENT0 + k);
      bufs.forEach((a, k) => gl.framebufferTextureLayer(gl.FRAMEBUFFER, a, tex, 0, k));
      gl.drawBuffers(bufs);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return null; }
      return { tex, fb };
    }
    // the rows a band may have: SPLIT.MB a set at the volume's width (64 bytes a pixel), the volume's at most
    const stateRows = () => Math.max(BAND_ROWS, Math.min(rH, Math.floor(SPLIT.MB * 1048576 / (64 * rW))));
    function dropState() {
      if (!stT) return;
      for (let i = 0; i < 2; i++) { gl.deleteFramebuffer(stT.fb[i]); gl.deleteTexture(stT.tex[i]); }
      stT = null;
      gl.activeTexture(gl.TEXTURE0 + SPLIT.UNIT); gl.bindTexture(gl.TEXTURE_2D_ARRAY, stDummy); gl.activeTexture(gl.TEXTURE2);
    }
    // the state for this volume's bands, made or made larger (null where its targets cannot be drawn into: then drawn whole)
    function stateFor() {
      const h = stateRows();
      if (stT && stT.w >= rW && stT.h >= h) return stT;
      dropState();
      const a = stateSet(rW, h), b = a && stateSet(rW, h);
      glErr('split state ' + rW + 'x' + h);
      if (!a || !b) { if (a) { gl.deleteFramebuffer(a.fb); gl.deleteTexture(a.tex); } splitOn = false; rec({ k: 'split', ok: 0, w: rW, h }); return null; }
      stT = { tex: [a.tex, b.tex], fb: [a.fb, b.fb], w: rW, h };
      return stT;
    }
    // (a frame drawn in kicks: the continuum's looks, by FULL, in the animation frames or a script's)
    // (round 10a, dev.6: and the gas line's, in the cheaper tier (one group a pass: see coRun; the full tier's passes of three groups
    // would need 24 numbers of state, and its slowest whole rays, 63 to 81 ms on the M1 Max, are within a desktop's budget in
    // bands). coKicks: the gas line's frames now in kicks)
    const coKicks = () => lookNow === 'co' && MARCH[rayBound ? march : 'full'].coP === 1;
    const splitLook = () => lookNow === 'optical' || lookNow === 'mir' || coKicks();
    const splitWants = (F) => splitOn && !!F && !fullFrame && !reduce && !probing && splitLook() && !splitBroken[frameKeyOf(F)] && !!stateFor();
    const needOf = (key) => { const r = kickNeed[key]; return r && r.length ? Math.max(...r) : SPLIT.N0; };
    const needNote = (key, n) => { const r = kickNeed[key] || (kickNeed[key] = []); r.push(n); if (r.length > SPLIT.RING) r.shift(); };
    // (round 10a, the first test of the march in kicks: its bands were never seen done (see FS), and the band's pieces, each
    // with half as many kicks again, grew to 820 ms of cheap kicks before the tab was closed. So a band's further pieces take
    // as many kicks as fit in the aim at the cost a kick had in its last piece (its first kicks are the dearest: all its rays
    // still go), and a band given more kicks than its rays can need, the most work a ray can do over a kick's (kickMax), ends
    // the march in kicks (recorded): the frame is left and drawn whole)
    const kickMax = (K = kickK) => Math.ceil((32768 + 2 * 640 * 0.25 + 3 * 32 + 64) / K) + 8;
    // the band in hand seen done or not: its last kick's query, read once the piece's fence has passed (false while the result
    // is not there yet). Done, the kicks it took are noted for the kind: n, or two fewer where the third from last drew nothing too
    function splitReady(j) {
      const bd = j && j.split ? j.bd : null;
      if (!bd || bd.done || !bd.qs.length) return true;
      const ts = performance.now(), last = bd.qs[bd.qs.length - 1];
      const avail = gl.getQueryParameter(last.q, gl.QUERY_RESULT_AVAILABLE);
      if (avail) {
        if (!gl.getQueryParameter(last.q, gl.QUERY_RESULT)) {
          bd.done = true;
          const q0 = bd.qs.length >= 3 && bd.qs[bd.qs.length - 3].k === last.k - 2 ? bd.qs[bd.qs.length - 3] : null;
          const early = !!q0 && gl.getQueryParameter(q0.q, gl.QUERY_RESULT_AVAILABLE) && !gl.getQueryParameter(q0.q, gl.QUERY_RESULT);
          needNote(j.kk, Math.max(3, early ? bd.k - 2 : bd.k));
        }
        for (const e of bd.qs) gl.deleteQuery(e.q);
        bd.qs = [];
      }
      slowSync('query', ts);
      return avail;
    }
    function splitDrop(j) { if (j && j.bd) { for (const e of j.bd.qs) gl.deleteQuery(e.q); j.bd = null; } }
    // (round 10a, the coordinator after the first test of the march in kicks: a frame in bands begun was drawn to its end
    // whatever changed meanwhile, and the runaway band went on after the checks' wire had switched to the model's look.) A
    // frame in bands is left at a jump (diskSet: a new view, look, cut or components; the wire's switch, Reset), when the page
    // is hidden away (pagehide) and at the context's loss: the picture before stays (the canvas is drawn at a frame's finish
    // only), and the next frame starts afresh (accN 0: the volume's target holds a part of the frame left)
    function cancelJob() {
      const j = bandJob;
      if (!j) return;
      if (j.split) { splitDrop(j); if (!lost) { gl.useProgram(j.prog); gl.uniform1i(j.U.uSplit, 0); gl.uniform1f(j.U.uRowOff, 0); } }
      frameLeft(j);
    }
    // (round 10a, dev.6: a frame in bands left: its measures so far dropped, and its pieces still in flight not counted in the next
    // frame's, see gpuPoll)
    function frameLeft(j) { j.cancelled = true; bandJob = null; accN = 0; dirty = true; gpuReset(); }
    window.addEventListener('pagehide', cancelJob, on);
    // (round 10a, A4: a still being refined is left at the first touch, wheel or key on the picture, so that the view answers at
    // once: the page refines a still up to its level's scale, a frame of which in kicks may take seconds)
    const leaveStill = () => { if (bandJob && bandJob.still) cancelJob(); };
    for (const t of ['pointerdown', 'wheel', 'keydown']) canvas.addEventListener(t, leaveStill, { ...on, capture: true, passive: true });
    // one kick of the band in hand: into the set its count picks, reading the other (the viewport, the scissor and the state's
    // texture unit set for the piece, see splitStep; round 10a, the CPU's part: each call is a message to the GPU's process in
    // WebKit, and a frame of the visible look is some 30 to 80 kicks); asked whether it drew (ask: the piece's last three)
    function kickDraw(j, bd, ask) {
      const w = bd.k % 2;
      gl.bindFramebuffer(gl.FRAMEBUFFER, stT.fb[w]); gl.bindTexture(gl.TEXTURE_2D_ARRAY, stT.tex[1 - w]);
      if (bd.k <= 1) gl.uniform1i(j.U.uKick0, bd.k === 0 ? 1 : 0);
      gl.uniform1f(j.U.uKickN, bd.k);
      // (the exact query: the conservative one may say a sample passed where none did, and the band would never be seen done)
      if (ask) {
        const q = gl.createQuery(); gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.endQuery(gl.ANY_SAMPLES_PASSED);
        bd.qs.push({ q, k: bd.k }); if (bd.qs.length > 3) gl.deleteQuery(bd.qs.shift().q);
      } else gl.drawArrays(gl.TRIANGLES, 0, 3);
      bd.k++;
      if (kickFlush === 'kick') gl.flush();   // (a command buffer for each kick; or for each piece, see kickFlush)
    }
    // the band's picture: from the state its rays left (both sets hold it), into the volume's target, as a band was drawn
    function emitBand(j, bd, tg) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb); gl.viewport(0, 0, rW, rH);
      gl.activeTexture(gl.TEXTURE0 + SPLIT.UNIT); gl.bindTexture(gl.TEXTURE_2D_ARRAY, stT.tex[(bd.k - 1) % 2]); gl.activeTexture(gl.TEXTURE2);
      gl.uniform1i(j.U.uSplit, 2); gl.uniform1f(j.U.uRowOff, bd.y0);
      if (j.acc && !j.stages) { gl.enable(gl.BLEND); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); gl.blendColor(0, 0, 0, 1 / (j.acc + 1)); }
      gl.enable(gl.SCISSOR_TEST); gl.scissor(0, bd.y0, rW, bd.y1 - bd.y0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
    }
    // A piece of a frame in kicks (bandStepIn's, for a job with split): the band before seen done drawn into the target, then
    // the next band's kicks, or more of the band in hand's; after the last band, the frame's finish. kickEach: one kick a
    // piece (box.diskSplit({ each }), to measure what a single kick holds the GPU for)
    // (round 10a, dev.6: a stage of the gas line's moments in kicks: its pass, its group and the sums before it to read)
    function coStage(j, sg) {
      gl.uniform1i(j.U.uCoPass, sg.p); gl.uniform1i(j.U.uCoG0, sg.g0 || 0); gl.uniform1i(j.U.uProbe, 0);
      gl.activeTexture(gl.TEXTURE0 + CO_UNIT); gl.bindTexture(gl.TEXTURE_2D, coAccT[1 - sg.out].tex); gl.activeTexture(gl.TEXTURE2);
      j.sentStage = j.si;
    }
    function splitStep(j) {
      gl.useProgram(j.prog);
      // (the volume's size changed under the frame, a new scale: the frame is left, and drawn anew)
      if (j.rW !== rW || j.rH !== rH) { splitDrop(j); frameLeft(j); return false; }
      // (a band's first piece measured, where it was long enough to be (KICK_MS_MIN): what its kicks cost a pixel (its first kicks,
      // when all its rays go, the dearest), for the rows and kicks after it)
      if (j.bd && j.bd.pieces === 1 && j.lastKicks > 0 && j.K === kOf(j.key) && !j.bd.cut) {
        // (a piece under KICK_MS_MIN is not timed (the fences are looked at every 8 ms or so): its kicks were under KICK_MS_MIN
        // over their count, enough to raise the work, not a cost for the rows)
        const rows = j.bd.y1 - j.bd.y0, ms = Math.max(j.lastMs, KICK_MS_MIN) / j.lastKicks;
        if (j.lastMs >= KICK_MS_MIN) {
          let m = kickT[j.kk];
          if (!m || m.w !== rW || m.h !== rH || m.K !== j.K) m = kickT[j.kk] = { ts: [], w: rW, h: rH, K: j.K, top: 0 };
          m.ts.push({ t: ms, rows }); if (m.ts.length > 4) m.ts.shift();
          m.top = Math.max(m.top, rows);
        }
        // (and the work of the kind's kicks from the next frame, see kickKOf: twice, where its band covers the frame with room)
        const half = 0.5 * (j.aim || 0.5 * (gBudget > 0 ? gBudget : 120));
        if (kickAdapt && !kickEach && rows >= Math.min(rH, stateRows()) && ms < KICK_UP * half && j.K < KICK_MAX) { kickKOf[j.key] = Math.min(KICK_MAX, 2 * j.K); kickReset(j.kk); }
      }
      // (round 10a, dev.6: the gas line's moments in kicks, see coRun: a stage's bands into its float target (the window's pass, a
      // group's pass), each pass reading the sums before it; after the last, the composite, drawn whole (a few texture reads))
      const sg = j.stages ? j.stages[j.si] : null;
      if (sg) coStage(j, sg);
      if (j.bd && j.bd.done) {
        emitBand(j, j.bd, sg ? coAccT[sg.out] : testT || accT); j.bands = (j.bands || 0) + 1;
        j.bandMs = 0; j.prevRows = kickRowsOf[j.kk] = j.bd.y1 - j.bd.y0; j.bd = null; kickFresh = false;
        if (sg && j.y >= rH) {
          j.si++; j.y = 0; j.prevRows = 0;
          const nx = j.stages[j.si];
          if (nx.p === 3) {
            const tg = testT || accT;
            gl.uniform1i(j.U.uSplit, 0); gl.uniform1f(j.U.uRowOff, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb); gl.viewport(0, 0, rW, rH);
            gl.uniform1i(j.U.uCoPass, 3); gl.uniform1i(j.U.uCoG0, 0); gl.uniform1i(j.U.uProbe, 0);
            gl.activeTexture(gl.TEXTURE0 + CO_UNIT); gl.bindTexture(gl.TEXTURE_2D, coAccT[nx.in].tex); gl.activeTexture(gl.TEXTURE2);
            if (j.acc) { gl.enable(gl.BLEND); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); gl.blendColor(0, 0, 0, 1 / (j.acc + 1)); }
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.disable(gl.BLEND);
            j.sentStage = j.si; j.pieces = (j.pieces || 0) + 1; j.n = j.bands;
            bandJob = null;
            gl.flush();
            j.finish();
            return false;
          }
          j.kk = j.key + (nx.p === 4 ? ':w' : ':g');
          coStage(j, nx);
        }
        if (!sg && j.y >= rH) {
          gl.uniform1i(j.U.uSplit, 0); gl.uniform1f(j.U.uRowOff, 0);
          j.pieces = (j.pieces || 0) + 1; j.n = j.bands;
          // (not the rows' costs of the frames drawn whole (stillSt, rowsAfter): its profile is not filled by a frame in kicks)
          bandJob = null;
          gl.flush();
          j.finish();
          return false;
        }
      }
      const aim = j.aim || 0.5 * (gBudget > 0 ? gBudget : 120);
      if (!j.bd) {
        // (a frame not sized as it goes has no row of its own yet: the first test of a page with no guard (ray-check.html) took
        // undefined for it, a band of no rows, every kick drew nothing and the band was seen done at once, without end)
        if (!(j.y >= 0)) j.y = 0;
        const st = stateFor();
        if (!st) { bandJob = null; dirty = true; gl.uniform1i(j.U.uSplit, 0); return false; }   // (the frame left; the next drawn whole)
        // (round 10a, the second test: bands sized as the rays drawn whole are, from a band's whole cost, made a frame of 25 to 45
        // thin bands in kicks, each paying its slowest ray's whole length: 2.7 times the frame drawn whole. A kick's cost is
        // bounded whatever the ray, so a band in kicks is as many rows as a kick of half the aim covers, at the cost its kind's
        // first kicks had a pixel (now kickT), up to the state's rows: the whole frame at the usual scales, its slowest ray paid
        // once. Where that is not known (a new kind, after a jump: the least band; or its pieces too short to measure) twice the
        // band before, of this frame or the last; and within a frame at most twice the band before (the rows ahead may be dearer))
        // (round 10a, optimizing: from the cost a pixel and a step measured at this size and work, see kickT; no kick sent whose
        // time so predicted is over half the aim: the band's rows cut to it, and where even the least band would be over, the
        // work of a kick halved first, its kind measured anew)
        const known = !!kickMs(j.kk, j.K);
        let fits = known ? kickRowsFor(j.kk, j.K, 0.5 * aim) : 0;
        if (known && fits < BAND_ROWS && j.K > kickK) { j.K = Math.max(kickK, j.K / 2); kickKOf[j.key] = j.K; kickReset(j.kk); fits = 0; }
        const prev = j.prevRows || kickRowsOf[j.kk] || 0;
        const least = kickLeast || BAND_ROWS;
        let rows = fits > 0 ? fits : known ? least : prev > 0 ? 2 * prev : least;
        if (j.prevRows > 0) rows = Math.min(rows, 2 * j.prevRows);
        // (cut: the frame's last rows, fewer than the band would have: not a measure of what its rows cost, see kickT)
        const want = testRows > 0 ? Math.min(st.h, testRows) : Math.max(1, Math.min(st.h, Math.max(least, rows)));
        rows = Math.min(want, rH - j.y);
        j.bd = { y0: j.y, y1: j.y + rows, k: 0, qs: [], done: false, pieces: 0, cut: rows < want && rows < BAND_ROWS * 4 };
        j.sent = rows; j.y += rows;
      }
      const bd = j.bd;
      if (bd.k >= kickMax(j.K)) {
        // (not drawn whole at once in its place: the frame is left, the picture before kept, and this kind drawn whole from
        // then on through the guard, its first frames in bands sized as they go (probeNext), its measures dropped)
        rec({ k: 'split', broken: 1, stuck: bd.k, key: j.key, rows: [bd.y0, bd.y1, rW, rH] });
        splitBroken[j.key] = true; splitDrop(j); j.cancelled = true; bandJob = null; dirty = true; accN = 0;
        probeNext = PROBE_FRAMES; delete gKnown[j.key.replace(/:F$/, '')];
        gl.uniform1i(j.U.uSplit, 0); gl.uniform1f(j.U.uRowOff, 0);
        return false;
      }
      const perKick = j.lastKicks > 0 && j.lastMs > 0 ? j.lastMs / j.lastKicks : 0;
      // (a band's first piece: as many kicks as fit in the aim at its kind's measured cost (the dearest: all its rays go), up to
      // those its kind's bands needed; four at most where its kind's first kicks have not been measured at so many rows, or not
      // at all. Then as many as fit in the aim at the cost a kick had in the band's last piece, at once, at most the kicks its
      // kind's bands needed beyond these, or half as many again)
      const want = Math.max(4, needOf(j.kk) - bd.k + 2, Math.ceil(bd.k / 2));
      // (round 10a, dev.5: a kick's cost is not the same all along the march: the first kicks go through the sky and the thin
      // envelope, the later ones through the disk, its steps of the same weight dearer on the GPU. On the phone's frame (?guard=70)
      // a piece of 28 kicks sized from the band's first piece at 1.2 ms a kick took 91 ms (3.2 ms a kick), one of 6 at scale 1
      // 81 ms. So the last piece's cost a kick twice over (KICK_RISE), for the rise to come. (The band's dearest kick twice over,
      // at most twice the kicks before, made pieces so small that the phone frame's mid-infrared cost 1.9 times its frame drawn
      // whole, its pieces' fences counted many times)
      const more = Math.max(1, perKick > 0 ? Math.min(want, Math.floor(aim / (KICK_RISE * perKick))) : 1);
      const t1 = kickAt(j.kk, j.K, bd.y1 - bd.y0), rows1 = bd.y1 - bd.y0;
      // (round 10a, dev.6: the gas line's band's first piece too at twice the measured cost a kick: its kicks' work varies more, a
      // step halved up to five times where the gas changes within it, so a band through the disk costs more than one measured
      // above it. On a desktop's frame (moment 0, scale 0.8, 546 rows) first pieces of 7 kicks so sized took 109 to 137 ms, the
      // aim 60)
      const rise1 = lookNow === 'co' ? KICK_RISE : 1;
      const drawn = (j.prevRows || kickRowsOf[j.kk] || 0) > 0;
      const fit = t1 > 0 ? Math.max(1, Math.floor(aim / (rise1 * t1))) : kickFirst(drawn);
      const first = Math.min(fit, t1 > 0 && rows1 <= kickT[j.kk].top ? needOf(j.kk) : kickFirst(drawn));
      const n = Math.min(kickMax(j.K) - bd.k, kickEach ? 1 : bd.k === 0 ? first : more);
      gl.uniform1i(j.U.uSplit, 1); gl.uniform1f(j.U.uKickK, j.K); gl.uniform1f(j.U.uRowOff, bd.y0);
      // (the band's rows from the bottom of the state's sets, for all the piece's kicks; and the state's unit, its texture bound
      // kick by kick, TEXTURE2 active again after them as everywhere else)
      const rows = bd.y1 - bd.y0;
      gl.viewport(0, 0, rW, rows); gl.scissor(0, 0, rW, rows); gl.enable(gl.SCISSOR_TEST);
      if (bd.k > 1) gl.uniform1i(j.U.uKick0, 0);
      gl.activeTexture(gl.TEXTURE0 + SPLIT.UNIT);
      // (only the last three kicks asked whether they drew: the band is seen done from its last, and done two kicks earlier
      // from the third from last, see splitReady; a query a kick was the most of a kick's calls)
      for (let i = 0; i < n; i++) kickDraw(j, bd, i >= n - 3);
      gl.activeTexture(gl.TEXTURE2);
      if (kickFlush !== 'kick') gl.flush();   // (one command buffer for the piece, at most the aim)
      gl.disable(gl.SCISSOR_TEST);
      gl.uniform1i(j.U.uSplit, 0); gl.uniform1f(j.U.uRowOff, 0);
      j.kicks = (j.kicks || 0) + n; j.pieces = (j.pieces || 0) + 1; j.sentStage = 0; j.lastKicks = n; j.lastMs = 0;
      bd.pieces++; j.bandPieces = Math.max(j.bandPieces || 0, bd.pieces);
      return true;
    }
    let accT = null, accN = 0, lastSig = [], jitN = 0;
    let fadeT = 0, fstats = null;   // fstats: a running measurement, see diskFrameStats
    // (round 10a) a frame drawn outside the animation frames (a new size, a new language, a script's time or clump, a touch
    // with reduced motion): its piece fenced as the animation frames' are, so that its time is measured and the next piece
    // waits for it (these sent pieces without a fence: no measure, and the next frame queued behind them unseen)
    function drawOut() { draw(); if (!lost && W) fence(!bandJob, lastJob, true); }
    function draw() {
      drawOnce();
      // reduced motion: no frames follow, so the exposure is found now (measured with blocking reads, redrawn), within the
      // engine's budget, each pass being a whole frame more. (Round 9: during a flight at fewer than about 7 frames a
      // second the exposure was corrected so in the same animation frame too, up to five more whole frames each after a
      // blocking read: a chain of GPU work five frames long where the frames are slow. It now follows a frame or two late,
      // measured on its small target and read back without waiting (aeRead, aeTrack): a short adaptation in view)
      const per = gBudget > 0 ? gC1(kindNow()) * opt.scale * opt.scale : 0;
      for (let i = 0; reduce && !bandJob && i < 5 && !(per > 0 && (i + 2) * per > gBudget) && W && !lost && ((aeOn() && !aeHeld()) || coOn()); i++) {
        if (aeSync) { gl.deleteSync(aeSync); aeSync = null; }   // a previous frame cannot undo this frame's correction
        aeReady = false;   // (Disk Lab v2: nor a reading already copied back)
        // (round 10a, dev.6: the pieces in flight looked at before the read, and those still in flight known done by its end: the
        // read waits for all the work sent before it. Their fences were seen only after the reads and the frames between, and a
        // model's frame of 15 ms of GPU work read 157 ms, the wire's trip at reduced motion)
        gpuPoll();
        const ts = performance.now();
        aePass(); gl.readPixels(0, 0, AE_W, AE_H, gl.RGBA, gl.UNSIGNED_BYTE, aePx); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        slowSync('readPixels ae (reduced motion)', ts);
        gpuDrained(ts);
        if (aeOn()) { if (!aeAim(aePx, aeLn, false)) break; aeLn = aeGoal; } else { if (!coAim(aePx, coLn)) break; coLn = coGoal; }
        drawOnce();
      }
    }
    // Disk Lab v2 (engine-patch.py): the exposure's measurement is copied back here, before this frame's passes are
    // queued (it was copied after them, behind this frame's GPU work); it is used further on, as before (aeReady).
    let aeReady = false;
    function aeRead() {
      if (reduce || !aeSync || aeReady || gl.clientWaitSync(aeSync, 0, 0) === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(aeSync); aeSync = null;
      const ts = performance.now();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, aeBuf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, aePx); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      slowSync('getBufferSubData ae', ts);   // (round 10a: see slowSync)
      aeReady = true;
    }
    function drawOnce() {
      // (round 9: and between the context's loss and its event, where a timer may run: a target made then is incomplete)
      if (!W || lost || gl.isContextLost()) return;
      if (bandJob && bandJob.split) splitDrop(bandJob);   // (round 10a: its kicks' queries)
      // (round 10a, dev.6: and its pieces not counted in this frame's measures, see frameLeft; its still's averaging kept)
      if (bandJob) { bandJob.cancelled = true; gpuReset(); }
      bandJob = null;   // (round 9: a frame still being drawn in bands is left; this one replaces it)
      aeRead();
      const preQ = gtBegin();   // (round 9, for checks: the work before the volume timed on the GPU, see diskGpuTime)
      const d0 = fstats ? performance.now() : 0;
      // the planet's fade, in real time (so that it also completes while the model is paused); the step is at most 0.1 s,
      // since a paused model draws nothing until something changes and the first frame of a fade would otherwise jump
      // to its end
      const now = performance.now(), dtR = fadeT ? Math.min(0.1, (now - fadeT) / 1000) : 0;
      fadeT = now;
      for (const p of planets) {
        const w = plWant(p);
        p.amp = reduce ? w : w > p.amp ? Math.min(w, p.amp + dtR / p.fade) : Math.max(w, p.amp - dtR / p.fade);
        if (p.amp === w) p.fade = 1.5;
      }
      for (const c of clumps) if (c.gone && c.amp > 0) c.amp = reduce ? 0 : Math.max(0, c.amp - dtR / CLEAR_S);   // (round 9: taken in by a new planet)
      const wantS = opt.slice ? 1 : 0;
      sliceU = reduce ? wantS : wantS > sliceU ? Math.min(wantS, sliceU + dtR / 1.5) : Math.max(wantS, sliceU - dtR / 1.5);
      // (a closed cut takes its new angle at once: the sweep shows the opening)
      cutA = reduce || sliceU <= 0 ? CUT_A[opt.cut] : toward(cutA, CUT_A[opt.cut], dtR, 0.9 * 4 / Math.PI);
      const wantA = opt.ann ? 1 : 0;
      annAmp = reduce ? wantA : wantA > annAmp ? Math.min(wantA, annAmp + dtR / 0.4) : Math.max(wantA, annAmp - dtR / 0.4);
      if (lookNow !== opt.look && (reduce || performance.now() - lookT0 >= 300)) {
        // (round 9: an observed look waits for FULL, linked and warmed; the picture held at the dip's darkest meanwhile)
        // (round 10a, dev.6: with reduced motion too, and until the warm's pipelines are made, see fullReady)
        const f = opt.look === 'model' ? true : fullProgram();
        if (f === true || f === false || (f && fullReady())) { lookNow = opt.look; kickResetAll(); }   // (round 10a: see kickKOf)
        else lookT0 = performance.now() - 300;
      }
      guardFrame();   // (round 9: the engine's own guard, see GFAC)
      const wantF = showField && lookNow === 'model' ? 1 : 0;
      fieldAmp = reduce ? wantF : wantF > fieldAmp ? Math.min(wantF, fieldAmp + dtR / 0.4) : Math.max(wantF, fieldAmp - dtR / 0.4);
      fieldG.setAttribute('opacity', fieldAmp.toFixed(3));
      COMP_BITS.forEach((b, i) => { compAmp[i] = toward(compAmp[i], opt.mode & b ? 1 : 0, dtR, 0.6); });
      modelAmp = toward(modelAmp, lookNow === 'model' ? 1 : 0, dtR, 0.4);
      msAmp = toward(msAmp, opt.ms ? 1 : 0, dtR, 0.6);
      asymAmp = toward(asymAmp, opt.asym ? 1 : 0, dtR, 0.6);
      marksAmp = toward(marksAmp, marksOn() ? 1 : 0, dtR, 0.4);
      wavesAmp = toward(wavesAmp, opt.waves ? 1 : 0, dtR, 0.6);
      snowNow();
      jetAmp = toward(jetAmp, opt.mode & 64 ? 1 : 0, dtR, 0.6);   // (round 8: the jet, see JET)
      fxAmp = reduce ? opt.fx : opt.fx > fxAmp ? Math.min(opt.fx, fxAmp + dtR / 0.4) : Math.max(opt.fx, fxAmp - dtR / 0.4);   // (round 8: see opt.fx)
      const wantE = (opt.mode & 32) ? 1 : 0;
      envAmp = reduce ? wantE : wantE > envAmp ? Math.min(wantE, envAmp + dtR / 1.5) : Math.max(wantE, envAmp - dtR / 1.5);
      camera();
      cutFrame();
      // (round 8, the owner: "the envelope should show when zoomed in somewhat closer too". It showed from about 150 au; now
      // faintly from ENV_FADE.NEAR (at ENV_FADE.K of its light by the whole disk's view, 90 au), and fully from afar)
      { const dC = Math.hypot(cam[0], cam[1], cam[2]); envVis = envAmp * (ENV_FADE.K * ss(ENV_FADE.NEAR[0], ENV_FADE.NEAR[1], dC) + (1 - ENV_FADE.K) * ss(ENV_FADE.FAR[0], ENV_FADE.FAR[1], dC)); }
      const magVis = lookNow === 'co' ? 0 : 1 - ss(1, MAG.SHOW, Math.hypot(cam[0], cam[1], cam[2]));   // the magnetosphere
      planetUniforms();
      // the planet shown close up: the most visible (within 1.5 to 5 au of the camera for the planet at 3 au, in
      // proportion to a for the others)
      let pV = null, pVis = 0, pPos = [0, 0, 0];
      for (const p of planets) {
        if (p.amp <= 0) continue;
        const pos = planetPosOf(p, time), k = p.a / PLANET.A, v = p.amp * (1 - ss(1.5 * k, 5 * k, Math.hypot(cam[0] - pos[0], cam[1] - pos[1], cam[2] - pos[2])));
        if (v > pVis) { pVis = v; pV = p; pPos = pos; }
      }
      planetGlowSet(pV, pVis);
      // the automatic exposure toward its goal (1 when off), eased; held through an outburst and a change of look
      if (!aeOn()) { aeGoal = 0; aeFresh = true; }
      // (eased over 0.15 s, 0.05 s while the view moves, so that the exposure keeps up with a flight toward the star)
      if (!aeHeld()) { aeLn += (aeGoal - aeLn) * (reduce ? 1 : Math.min(1, dtR / (aeTrack && viewMoving() ? 0.05 : 0.15))); if (Math.abs(aeGoal - aeLn) < 1e-3) aeLn = aeGoal; }
      if (!coOn() && !coPending && coSavedKey !== coKey) { coGoal = 0; coFresh = true; }
      coLn += (coGoal - coLn) * (reduce ? 1 : Math.min(1, dtR / 0.15)); if (Math.abs(coGoal - coLn) < 1e-3) coLn = coGoal;
      // (the star itself keeps its brightness: far brighter than the disk, it stays white whatever the exposure)
      const dS = Math.hypot(cam[0], cam[1], cam[2]), lg = LOOK_GAIN[lookNow] ? Math.pow(LOOK_GAIN[lookNow], ss(8, 60, dS) * (1 - ss(120, 300, dS))) : 1;
      const expo = opt.exposure * lg * Math.exp(aeLn) * Math.pow(burstL(), 0.6) * lookDip(), starL = Math.pow(burstL(), 0.7) * LOOK_STAR[lookNow] / (Math.exp(aeLn) * lg);
      const envMade = !env3T && envVis > 0; if (envVis > 0) makeEnv3();   // (round 9: made in this frame, a first use; see warmFull)
      // the volume, with the FULL program while the slice or the planet close up shows (the usual one stands in while
      // FULL is still compiling)
      // (round 9) what FULL draws waits for it warmed (see warmFull): an observed look (above), and in the model's look the
      // cut, a planet close up and the field lines; the page is told ('diskwait'), and the warm asked for at once
      const featF = sliceU > 0 || !!opt.slice || pVis > 0 || magVis > 0;
      if (!warming) {
        const waitF = full !== false && !fullReady() && (lookNow !== opt.look || featF);
        if (waitF !== waitShown) { waitShown = waitF; box.dispatchEvent(new CustomEvent('diskwait', { detail: { wait: waitF ? 1 : 0 } })); }
        if (waitF && !fullWarm && !warmQueued) { warmQueued = true; setTimeout(warmFull, 0); }
      }
      // (round 10a, dev.6: no frame drawn by FULL before its warm's pipelines are made, in every path: reduced motion drew it at once
      // (its frames come on demand, never waiting for the warm), and the first FULL frame's blocking read for the exposure waited
      // for the pipelines, 187 ms on the M1 Max; the frames of the model's look leave its parts out meanwhile, as the animation
      // frames do while they wait (frameIn))
      const tF = performance.now(), F = warming || lookNow !== 'model' || (featF && fullReady()) ? fullProgram() : null, U = F ? F.U : U0;   // (round 8: not for the envelope)
      if (F) slowSync('fullProgram', tF);   // (round 10a, dev.6: linked here where the browser cannot link in the background)
      fNow = !!F;   // (round 10a: see knownNow)
      // a still picture (see ACC_MAX): the same state as the last frame, drawn by the same program
      const sig = [time, ...cam, ...basis.f, rW, rH, canvas.width, opt.steps, opt.fov, opt.seed, starL, LOOKS[lookNow], rSn, opt.mode, BG.MODES[opt.bg], ...compAmp, ...opt.gain,
        sliceU, cutA, SLICE_Q[opt.sliceQ] || 0, ...planets.flatMap((p) => [p.a, p.d, p.wake]), ...plGlowD, wavesAmp, pVis, envVis, magVis, msAmp, asymAmp, CO_MODES[opt.coMode], opt.coV, F ? 1 : 0, ...clumps.flatMap((c) => [c.R, c.phi, c.t0, c.amp]), ...vapor.flatMap((v) => [v.amp, v.t0]), coLn, expo];
      // (a new view: the exposure is measured afresh, with its moves counted anew; a new exposure or CO range: measured again)
      const ne = sig.length - 2, viewNew = sig.length !== lastSig.length || sig.some((v, i) => i < ne && v !== lastSig[i]);
      // (Disk Lab v2) While only the clock moves, the picture is not started over but averaged with the last few frames
      // (an exponential average, the new frame weighted 1/(ema + 1)), the jitter's sequence going on: the march's grain
      // and the static lattice of its jitter (see SHOW_FS) fade as in a still picture. The content hardly moves in a
      // frame, since the clock follows the radius in view (clockK): the frames averaged are as many as its largest shift
      // in a frame allows, taken at the inner part of what is in view (a quarter of that radius), with the view's own slow
      // turn with the clock (opt.spin: the camera moves with it, sig[1..6]), in render pixels: under 0.25 px six, 0.6 px
      // three, 1.2 px one, beyond that none (the picture starts over each frame, as before). (What else follows the clock
      // changes by a hair in a frame, as the planet's visibility while it orbits near the camera: under 2e-3 is let pass;
      // fades and sweeps step by a few hundredths.)
      const hair = (v, w) => v === w || (typeof v === 'number' && typeof w === 'number' && Math.abs(v - w) <= 2e-3 * Math.max(1, Math.abs(v)));
      const clockOnly = !reduce && sig.length === lastSig.length && sig[0] !== lastSig[0] && sig.every((v, i) => i <= 6 || hair(v, lastSig[i]));
      let ema = 0;
      if (clockOnly && box.dataset.ema !== 'off') {
        const rv = Math.hypot(Math.hypot(camT[0], camT[1], camT[2]), CLOCK.K * camD), Rm = Math.max(MODEL.R_IN, 0.25 * rv);
        const fpx = 0.5 * rH / Math.tan(opt.fov / 2), pxAu = fpx / camD;
        const turn = Math.hypot(sig[1] - lastSig[1], sig[2] - lastSig[2], sig[3] - lastSig[3]) / camD;   // (rad)
        const shift = 0.5236 * Math.pow(Rm, -1.5) * Math.abs(time - lastSig[0]) * Rm * pxAu + turn * fpx;
        ema = shift < 0.25 ? 6 : shift < 0.6 ? 3 : shift < 1.2 ? 1 : 0;
      }
      if (viewNew || sig[ne] !== lastSig[ne] || sig[ne + 1] !== lastSig[ne + 1]) { accN = ema && accN ? Math.min(accN, ema) : 0; aeFresh = false; coFresh = false; }
      const key = [Math.round(10 * Math.log(Math.hypot(...cam))), Math.round(20 * camEl), Math.round(20 * camAz), ...panV.map((v) => Math.round(10 * v / camD)), lookNow, opt.mode, opt.slice ? opt.cut + opt.sliceQ : '', follow, msAmp, W, Hh, opt.coMode, opt.coV].join();
      if (key !== aeKey) { aeKey = key; aeTries = 0; aeLo = -Infinity; aeHi = Infinity; aeGen++; }
      // (the CO line's range: searched again for a new view, look or display; held when only the components change)
      const coK = [Math.round(10 * Math.log(Math.hypot(...cam))), Math.round(20 * camEl), Math.round(20 * camAz), ...panV.map((v) => Math.round(10 * v / camD)), lookNow, follow, W, Hh, opt.coMode, opt.coV].join();
      if (coK !== coKey) { coKey = coK; coTries = 0; coLo = -Infinity; coHi = Infinity; coHold = false; coSavedKey = ''; coGen++; }
      else if (lookNow === 'co' && coModeSeen >= 0 && opt.mode !== coModeSeen) { coHold = true; coGoal = coLn; coFresh = true; coGen++; }
      coModeSeen = opt.mode;
      if (coPending && !viewMoving() && lookNow === opt.look && lookDip() === 1 && fadesDone()
        && planets.every((p) => p.amp === plWant(p)) && envAmp === wantE && sliceU === wantS && (sliceU <= 0 || cutA === CUT_A[opt.cut]) && annAmp === wantA && fieldAmp === wantF) {
        coLn = coGoal = coPending.ln; coHold = coPending.fixed; coPending = null;
        coSavedKey = coKey; coTries = AE.TRIES; coLo = -Infinity; coHi = Infinity; coFresh = true; coGen++;
        accN = 0; sig[ne] = coLn;
      }
      lastSig = sig;
      const acc = accN, mapsDue = !acc || clockOnly;   // (the maps follow the clock)
      if (mapsDue) {
        drawWindMap(Math.round(ASYM_F_JS * asymSm() * 100) / 100);
        // (round 9: while only the clock moves, the eddies drawn every eddyEvery frames: 2 on a guarded device, a phone's
        // power; they move on orbital time scales, and 15 updates a second at 30 frames do not show. 1 elsewhere)
        if (box.dataset.eddy !== 'off' && (!clockOnly || eddyEvery <= 1 || ++eddyTick % eddyEvery === 0)) { firstUse('eddy'); eddyPass(); }   // (round 10a: data-eddy="off", a switch to try on a phone)
        windPass();
        // the disk map for this moment and view (the footprints of the pixels depend on the camera)
        gl.useProgram(progDisk);
        gl.uniform1i(UD.uNP, plNP); gl.uniform4fv(UD.uPl, plData); gl.uniform2fv(UD.uGapR, gapR);
        gl.uniform1f(UD.uWakeX, wavesAmp);
        gl.uniform1f(UD.uTime, time); uploadPhaseClock(progDisk);
        gl.uniform1f(UD.uSeed, opt.seed);
        gl.uniform3fv(UD.uCam, cam);
        gl.uniform1f(UD.uPixA, 2 * Math.tan(opt.fov / 2) / rH);
        gl.uniform2fv(UD.uAccK, accK());
        { const c = ACC.C_SYM + (ACC.C_ASYM - ACC.C_SYM) * asymSm(); gl.uniform2f(UD.uAccC, c, c); }
        gl.bindFramebuffer(gl.FRAMEBUFFER, diskMapT.fb); gl.viewport(0, 0, diskMapT.w, diskMapT.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (opt.bg === 'cloud') skyMap();   // (round 8: drawn once, see BG)
      gl.bindFramebuffer(gl.FRAMEBUFFER, accT.fb);
      gl.viewport(0, 0, rW, rH);
      gl.useProgram(F ? F.prog : prog);
      gl.uniform1i(U.uBg, BG.MODES[opt.bg]);
      gl.uniform1i(U.uRayB, rayBound ? 1 : 0);   // (round 9: see CO_IT, CT_IT)
      gl.uniform1i(U.uCtMax, ctMax);   // (round 10a: see box.diskCtMax)
      gl.uniform1i(U.uProbe, probing);
      { const m = rayBound ? MARCH[march] : MARCH.full; gl.uniform4f(U.uMarch, m.sub, m.coStep, m.coRef, m.coThr); gl.uniform1i(U.uCoRec, m.coRec); gl.uniform1i(U.uCoP, m.coP); gl.uniform3fv(U.uCoIt, m.coIt); gl.uniform3fv(U.uCtIt, m.ctIt); }
      gl.uniform1i(U.uCoPass, 0); gl.uniform1f(U.uCoDith, 0);
      gl.uniform1i(U.uNP, plNP); gl.uniform4fv(U.uPl, plData); gl.uniform2fv(U.uGapR, gapR);
      gl.uniform4fv(U.uPlTrap, plTrapD);
      gl.uniform4fv(U.uPlGap, plGapD);
      gl.uniform4fv(U.uPlRim, plRimD);
      gl.uniform2f(U.uRes, rW, rH);
      gl.uniform1f(U.uTime, time);
      gl.uniform3fv(U.uCam, cam);
      gl.uniformMatrix3fv(U.uBasis, false, [...basis.r, ...basis.u, ...basis.f]);
      gl.uniform1f(U.uTanHalf, Math.tan(opt.fov / 2));
      gl.uniform1f(U.uRSnow, rSn);
      gl.uniform1f(U.uLum, lumNow);
      gl.uniform1f(U.uExposure, expo);   // brighter starlight, compressed by the stretch
      gl.uniform1f(U.uStar, starL);
      // the dipole: tilted toward the azimuth the star has turned to (it turns with the star, MAG.SPIN)
      const phS = (MAG.SPIN * time) % (2 * Math.PI), sT = Math.sin(MAG.TILT), cT = Math.cos(MAG.TILT);
      const mAx = [sT * Math.cos(phS), sT * Math.sin(phS), cT], e1 = [Math.cos(phS) - sT * mAx[0], Math.sin(phS) - sT * mAx[1], -sT * mAx[2]], e1n = Math.hypot(...e1);
      gl.uniform1f(U.uMag, magVis);
      gl.uniform1f(U.uStarK, Math.exp(-aeLn));
      gl.uniform3fv(U.uMagAxis, mAx);
      gl.uniform3f(U.uMagE1, e1[0] / e1n, e1[1] / e1n, e1[2] / e1n);
      gl.uniform1f(U.uMagT, time % 600);
      // the wind's puffs (see puffFactor): their clock, and in the model's look only
      gl.uniform1f(U.uPuffT, time % (PUFF.P * 1000));
      gl.uniform1f(U.uPuff, lookNow === 'model' ? modelAmp : 0);
      magFrame = { vis: magVis, ax: mAx, e1: e1.map((v) => v / e1n) };
      gl.uniform1i(U.uLook, LOOKS[lookNow]);
      gl.uniform3fv(U.uMat, matLin);   // (round 8: the materials' colours, see MAT)
      // (round 8) the jet: its fade times the look's strength, the lower lobe's speed with the asymmetry, the clock
      gl.uniform1f(U.uJet, jetAmp * jetAmp * (3 - 2 * jetAmp) * (JET.LOOK[lookNow] || 0));
      gl.uniform1f(U.uJetLow, 1 - (1 - 1 / JET.LOW) * asymSm());
      gl.uniform1f(U.uJetT, time % 3600);
      gl.uniform1i(U.uSteps, Math.round(opt.steps * (camD < 10 ? 2 : 1)));   // finer march when zoomed in
      gl.uniform1f(U.uSeed, opt.seed);
      gl.uniform1f(U.uPx, rW / W);
      gl.uniform4fv(U.uClump, clumps.flatMap((c) => [c.R, c.phi, c.t0, c.amp]));
      gl.uniform4fv(U.uVapor, vapor.flatMap((v) => [v.R, v.phi, v.t0, v.amp]));
      gl.uniform1i(U.uMode, (opt.mode & ~15) | COMP_BITS.reduce((m, b, i) => m | (compAmp[i] > 0 ? b : 0), 0));
      gl.uniform4fv(U.uComp, compAmp.map((v, i) => v * v * (3 - 2 * v) * opt.gain[i]));
      gl.uniform1f(U.uMS, msAmp * msAmp * (3 - 2 * msAmp));
      // (round 8) the star's light in the model's look and the finish, by the quality of the moment (see FX)
      gl.uniform1f(U.uLit, modelAmp * Math.min(fxAmp, 1)); gl.uniform1f(U.uFx, Math.min(fxAmp, 1) * modelAmp);
      gl.uniform1f(U.uFocus, Math.max(camD, 1e-3));
      gl.uniform1f(U.uWindLow, 1 - (1 - WIND_LOW_JS) * asymAmp * asymAmp * (3 - 2 * asymAmp));
      gl.uniform2fv(U.uAcc, accW());
      gl.uniform2fv(U.uAccV, accK());
      gl.uniform1i(U.uCoMode, CO_MODES[opt.coMode]);
      gl.uniform1f(U.uCoV, opt.coV);
      gl.uniform1f(U.uCoRange, coRange());
      gl.uniform1f(U.uCoK, Math.exp(coLn));
      gl.uniform1i(U.uSlice, sliceU > 0 ? 1 : 0);
      gl.uniform1f(U.uCutA, cutA);
      gl.uniform1f(U.uSliceOff, sliceOff());
      gl.uniform1f(U.uSliceFace, ss(0.82, 1, sliceU));
      gl.uniform1i(U.uSliceQ, SLICE_Q[opt.sliceQ] || 0);
      gl.uniform3fv(U.uSliceN, cutFn);
      gl.uniform3fv(U.uSliceR, cutFr);
      gl.uniform1f(U.uSliceZ, SZ);
      gl.uniform4f(U.uPlV, pPos[0], pPos[1], pPos[2], pVis);
      gl.uniform4fv(U.uPlG, plGlowD);
      gl.uniform1f(U.uPlVa, pV ? pV.a : PLANET.A);
      gl.uniform1f(U.uPlVq, pV ? pV.q : PLANET.Q);
      gl.uniform4fv(U.uCpd, cpdOf(pV));
      gl.uniform1f(U.uEnv, envVis);
      // frame acc of a still picture: R2 and golden-ratio sequences (none for the first), weighted 1/(acc + 1); the
      // sequence runs on through the averaged frames while the clock moves (jitN)
      const jn = acc || probeJit ? ++jitN : 0;   // (round 10a: diskRayProbe({ jitter }) draws with the next offset)
      gl.uniform3f(U.uJit, jn ? (jn * 0.7548777) % 1 - 0.5 : 0, jn ? (jn * 0.5698403) % 1 - 0.5 : 0, (jn * 0.618034) % 1);
      // the cut face at the screen's resolution (the same program and uniforms, see faceAt), drawn again when the picture
      // starts over (it does not depend on a still's jitter), before the volume (which leaves out what lies behind it
      // where it is opaque): one sample per pixel into faceA (unit 12, unbound while it is drawn into), then faceT (unit
      // 11, for SHOW_FS), four samples where the face changes from pixel to pixel
      const faceOn = !!F && sliceU > 0.82 && lookNow === 'model';
      if (faceOn && mapsDue) {
        if (!faceT) {
          faceA = target(canvas.width, canvas.height, gl.RGBA8, gl.CLAMP_TO_EDGE); faceT = target(canvas.width, canvas.height, gl.RGBA8, gl.CLAMP_TO_EDGE); glErr('face');
          gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, faceT.tex);
        }
        gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, noFace);
        gl.viewport(0, 0, faceT.w, faceT.h); gl.uniform2f(U.uRes, faceT.w, faceT.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, faceA.fb); gl.uniform1i(U.uFacePass, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, faceA.tex); gl.activeTexture(gl.TEXTURE2);
        gl.bindFramebuffer(gl.FRAMEBUFFER, faceT.fb); gl.uniform1i(U.uFacePass, 2); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.uniform1i(U.uFacePass, 0); gl.uniform2f(U.uRes, rW, rH);
        gl.bindFramebuffer(gl.FRAMEBUFFER, accT.fb); gl.viewport(0, 0, rW, rH);
      }
      gl.uniform1i(U.uFaceRdy, faceOn ? 1 : 0); gl.uniform2f(U.uFaceRes, canvas.width, canvas.height);
      // (the first frame replaces what the target holds, so that nothing from before carries over, not even a NaN:
      // blended with weight 0 it would stay, since NaN times 0 is NaN)
      // (round 9) The volume, in one draw or in bands (see bandsFor): a frame in bands is a job (bandJob) whose first band is
      // drawn here and the others by bandStep, one per animation frame (frame), each sent to the GPU on its own; the rest
      // of the frame (the finish, the display, the exposure's measurement, the overlay) comes after the last band. Until
      // then the canvas keeps the picture shown before (nothing is drawn into it), so that a still picture drawn at a
      // higher scale replaces the one before when it is whole. Reduced motion has no animation frames: its bands are all
      // sent in this task, each flushed on its own, as a snapshot's were before round 9.
      // (round 9: the warm draw, see warmFull: one pixel in each blend state, nothing else of the frame)
      if (warming) {
        // (into a 1 x 1 target of the volume's format, not the volume's own: a picture being drawn or accumulated is left as
        // it is; its pixel is the corner ray of the view, uRes kept)
        if (!warmV) warmV = target(1, 1, gl.RGBA16F, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, warmV.fb); gl.viewport(0, 0, 1, 1); gl.useProgram(F.prog);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.BLEND); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); gl.blendColor(0, 0, 0, 0.5);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disable(gl.BLEND);
        // (round 9: and the moments' passes, into float targets of their own format)
        if (!warmC) warmC = target(1, 1, CO_FMT, gl.CLAMP_TO_EDGE, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, warmC.fb); gl.viewport(0, 0, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // (round 10a: and a kick of the march in kicks, into a 1 x 1 state of its own: four layers of 32-bit floats, a pipeline
        // of its own; see SPLIT)
        if (splitOn && !warmS) warmS = stateSet(1, 1);
        if (splitOn && warmS) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, warmS.fb); gl.viewport(0, 0, 1, 1);
          gl.activeTexture(gl.TEXTURE0 + SPLIT.UNIT); gl.bindTexture(gl.TEXTURE_2D_ARRAY, stDummy); gl.activeTexture(gl.TEXTURE2);
          gl.uniform1i(U.uSplit, 1); gl.uniform1i(U.uKick0, 1); gl.uniform1f(U.uKickK, kickK); gl.uniform1f(U.uKickN, 0); gl.uniform1f(U.uRowOff, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.uniform1i(U.uSplit, 0);
          variants.add('Fs');
        }
        // (and the cut face's pass, into 8-bit targets: a pipeline of its own)
        if (!warmT) warmT = target(1, 1, gl.RGBA8, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, warmT.fb); gl.viewport(0, 0, 1, 1); gl.uniform1i(U.uFacePass, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.uniform1i(U.uFacePass, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        variants.add('F'); variants.add('Fb'); variants.add('F8'); variants.add('Fc');
        lastWarmGt = gtNote(gtEnd(preQ), { what: 'warm', key: kindNow(), first: 1 });
        return;
      }
      // (round 9) The frame's work before its volume (the maps for this moment: the wind's, the eddies', the wind's streamers,
      // the disk's; the sky's; the cut face at the screen's resolution; the tables uploaded): sent on its own and measured as
      // a piece of its own, which the guard counts with the frame's. It ran in the volume's first piece, unseen: a settling
      // piece of 325 ms in the stills' wind place. A script's frame (adaptRows) waits for it before its first band
      // (scriptFrame); an animation frame sends its first band after it, as a separate submission.
      const pre = !warming && !fullFrame && !reduce;
      lastPreGt = gtNote(gtEnd(preQ), { what: 'pre', key: frameKeyOf(F), first: 0 });
      // (round 10a: told to the recorder as a dear piece after a jump, at the start, or when the last one was dear; see rec)
      let preRid = 0;
      if (pre && adaptRows === 0 && (probeNext > 0 || !(lastPreMs >= 0) || !(gBudget > 0) || lastPreMs > DEAR * gBudget)) { preRid = ++recId; rec({ k: 'piece', ph: 0, id: preRid, key: frameKeyOf(F) + ':pre', sc: opt.scale, pred: Math.round(lastPreMs >= 0 ? lastPreMs : 0), first: 0, s: 'pre' }); }
      if (pre && adaptRows === 0) { const ts = performance.now(), sy = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); slowSync('fenceSync pre', ts); flight.push({ s: sy, t: performance.now(), end: false, n: 1, px: rW * rH, scale: opt.scale, key: frameKeyOf(F), still: paused, first: false, j: null, st: null, pre: true, gt: lastPreGt, rid: preRid }); gl.flush(); if (!gpuTimer) gpuTimer = setTimeout(gpuTick, GPU_LOOK); }
      const job = { prog: F ? F.prog : prog, U, acc, n: bandsFor(), b: 0, key: frameKeyOf(F), finish: null };
      // (round 10a: the march in kicks, see SPLIT; the volume's size it was begun at)
      job.split = splitWants(F); job.rW = rW; job.rH = rH; job.still = paused;
      // (round 10a: a kind measured at another size of the volume: from its first use again, see kickT)
      // (round 10a, dev.6: and the gas line's stages, measured apart: see coStage)
      if (job.split) { const k0 = frameKeyOf(F), m0 = kickT[k0]; if (m0 && (m0.w !== rW || m0.h !== rH)) for (const k of [k0, k0 + ':w', k0 + ':g']) kickReset(k, true); job.K = kOf(k0); }
      job.kk = job.key;
      // (round 9: the moments in passes, see coGrid: each group pass, then the composite, every one a piece of its own in its
      // bands; the bands asked for the frame shared among the group passes)
      const nPass = F ? coPassesNow() : 0;
      if (nPass > 0) {
        coAccOf();
        const P = CO_Q / nPass;
        // (round 10a, dev.6: in kicks, the window found by a pass of its own (uCoPass 4) first, its sums zero; then a pass a group)
        if (job.split) job.stages = [{ p: 4, out: 0 }].concat(Array.from({ length: nPass }, (_, k) => ({ p: 2, g0: k * P, out: (k + 1) % 2 }))).concat([{ p: 3, in: nPass % 2 }]);
        else job.stages = Array.from({ length: nPass }, (_, k) => ({ p: 2, g0: k * P, out: k % 2 })).concat([{ p: 3, in: (nPass - 1) % 2 }]);
        if (job.split) job.kk = job.key + ':w';
        job.si = 0; job.nb = Math.max(1, Math.ceil(job.n / nPass)); job.n = nPass * job.nb + 1; job.probeAt = coProbeAt;
      }
      // (round 9: a script's frame, each band waited for: its bands sized as it goes, see adaptRows)
      // (round 10a: its first band within what this kind is known to cost, or the least band where it is not, see firstRows)
      const aimFirst = adaptAim > 0 ? adaptAim : 0.5 * (gBudget > 0 ? gBudget : 120);
      if (adaptRows > 0 && !fullFrame) { job.ad = true; job.y = 0; job.rows = Math.min(rH, Math.max(BAND_ROWS, Math.min(adaptRows, firstRows(aimFirst)))); job.n = (job.stages ? job.stages.length : 1) * Math.ceil(rH / job.rows); }
      // (round 9: the first animation frames after a jump, see probeNext: the same, each band's rows from the one before)
      // (round 10a: and any frame of a kind not measured lately (gKnown, 30 s): a prediction carried by the factors is not
      // trusted with a whole frame)
      else if ((probeNext > 0 || (gBudget > 0 && !knownNow(kindNow()))) && !fullFrame && !snapping && !stepping && !reduce) {
        if (probeNext > 0) probeNext--;
        job.ad = true; job.st = {}; job.y = 0; job.rows = firstRows(aimFirst); job.n = (job.stages ? job.stages.length : 1) * Math.ceil(rH / job.rows);
      }
      // (round 10a) A frame meant to be in bands (a still, or a look over the budget at the lowest scale) is sized as it goes too:
      // its bands from the cost row by row of the frame before of the same picture (stillSt), or, for its first frame, from
      // what the kind is known to cost or the least band. Its uniform bands were sized by the prediction, and where that was
      // low one band was long: 331 ms of GPU time in round 10a's checks (the visible look's still after a jump, the page's
      // bands from a c1 measured on the model)
      else if (job.n > 1 && !fullFrame && !snapping && !stepping && !reduce) {
        // (a new picture, not the next frame of a still nor of the clock alone, starts over: another view costs otherwise)
        const k = job.key + (job.stages ? ':' + job.stages.length : '');
        if (!stillSt || stillSt.key !== k || stillSt.rW !== rW || stillSt.rH !== rH || (!acc && !clockOnly)) stillSt = { key: k, rW, rH, prof: job.stages ? null : new Float32Array(rH) };
        job.ad = true; job.st = stillSt; job.y = 0; job.rows = firstRowsOf(stillSt, aimFirst);
        job.n = (job.stages ? job.stages.length : 1) * Math.ceil(rH / job.rows);
      }
      const vk = (F ? 'F' : 'U') + (acc ? 'b' : '');
      job.first = !variants.has(vk) || (faceOn && mapsDue && !variants.has('F8')) || (envMade && !!env3T) || (!!job.stages && !variants.has('Fc')) || (job.split && !variants.has('Fs'));
      if (job.first) rec({ k: 'first', w: vk + (faceOn && !variants.has('F8') ? '+F8' : '') + (job.stages && !variants.has('Fc') ? '+Fc' : '') + (envMade ? '+env3' : ''), key: job.key });   // (round 10a)
      variants.add(vk); if (faceOn) variants.add('F8'); if (job.stages) variants.add('Fc'); if (job.split) variants.add('Fs');
      bandJob = lastJob = job;
      job.finish = () => {
      accN = acc + 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // (round 8) the finish (see BLOOM): the glow of the bright parts and the tone curve, by the quality of the moment; in
      // the model's look only (the observed looks keep the stretch they are compared by: DESIGN.md, section 21)
      const fin = Math.min(fxAmp, 1) * modelAmp, bk = Math.max(0, Math.min(fxAmp - 1, 1)) * modelAmp * BLOOM.K;
      const bp = bk > 0 ? (firstUse('bloom'), bloomPass()) : [1, 1];
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(progShow);
      gl.uniform3f(uShowBloom, bp[0], bp[1], bk); gl.uniform1f(uShowTone, fin * TONE);
      gl.uniform2f(uShowDev, canvas.width, canvas.height); gl.uniform1i(uShowFace, faceOn ? 1 : 0);
      gl.uniform4f(uShowPart, rW / accT.w, rH / accT.h, (rW - 0.5) / accT.w, (rH - 0.5) / accT.h);
      // (the tent filter while the picture is not yet averaged: full on a single frame, gone after four; data-soft="off"
      // turns it off, to compare)
      gl.uniform2f(uShowTexel, 1 / accT.w, 1 / accT.h);
      gl.uniform1f(uShowSoft, box.dataset.soft === 'off' ? 0 : Math.max(0, 1 - acc / 4));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (healthWanted && !healthSync) healthPass({ key: frameKeyOf(F), scale: opt.scale, acc: accN, size: [rW, rH] });   // (round 10a: see HEALTH_FS)
      // the automatic exposure's measurements, one at a time: started on a frame drawn at the exposure's goal, read on a
      // later frame once the GPU has done it (reduced motion measures in draw instead)
      // (the same measurements set the CO line's range in its look)
      const aeNow = aeOn() && !aeHeld(), coNow = coOn() && !coHold && !coPending && coSavedKey !== coKey, moving = aeNow && viewMoving();
      if (!reduce && (aeNow || coNow)) {
        if (aeReady) {   // (copied at the start of the frame, in aeRead)
          aeReady = false;
          // (a reading taken while the view moved is used whatever the view is by now: the exposure follows)
          if (aeKindUsed === 'model' && aeNow && (aeGenUsed === aeGen || aeTrack)) aeAim(aePx, aeLnUsed, aeTrack);
          else if (aeKindUsed === 'co' && coNow && coGenUsed === coGen) coAim(aePx, aeLnUsed);
        }
        // (measured on the first frame of a picture, drawn without the jitter of a still's refinement, so that a state
        // gives the same measurements whichever way it was reached; a still being refined that still needs one starts over;
        // while the view moves, on every frame that can be, before the exposure has reached its goal)
        if (!aeSync && (moving || (aeNow ? aeGoal === aeLn : coGoal === coLn))) {
          if (acc === 0 || clockOnly) {
            aePass();
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, aeBuf); gl.readPixels(0, 0, AE_W, AE_H, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            aeSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
            aeLnUsed = aeNow ? aeLn : coLn; aeGenUsed = aeGen; coGenUsed = coGen; aeKindUsed = aeNow ? 'model' : 'co'; aeTrack = moving;
          } else if (aeNow ? !aeFresh : !coFresh) accN = 0;
        }
      }
      const f0 = performance.now(), o0 = f0;
      drawField();
      drawFlow();
      drawMag();
      drawAcc();
      drawEnv();
      drawCoBar();
      fieldMs = performance.now() - f0;
      drawSlice();
      legendEvent();
      // snow line annotation, projected with the same camera; with the slice, only the half that is kept
      // (on a painted face the ice boundary is drawn instead)
      // (the label goes where the field lines leave room: of the ring's points on the screen, the one whose label box
      // covers fewest of the lines' visible samples, the lowest of those; the ring and its label go when the ring is
      // under 40 px across (Disk Lab v2: fading in to 70 px; its name only from 110 to 160 px, once the ring is wider than
      // the name: smaller, the name came before the ring could be seen), or off the screen, and while the camera is inside the ring or just above it, within 1.25 of
      // its radius from the axis: its points beside the camera would be thrown far off the screen. The path is cut where
      // a point lies off the picture by more than the picture's size, or a step on the screen spans more than half of
      // it (the ring is sampled too coarsely there to be drawn straight); its points come back to the first, so it is
      // not closed with Z, which would join the ends of a cut path across the picture.)
      let d = '', pen = false, qPrev = null;
      const inRing = Math.hypot(...cam) < 1.25 * rSn;   // actual proximity: a high, face-on camera is outside the ring
      const ringA = annAmp * (1 - ss(0.82, 1, sliceU)), ringOn = ringA > 0.002 && !inRing, pts = [];
      let x0r = Infinity, x1r = -Infinity;
      for (let i = 0; i <= 72 && ringOn; i++) {
        const a = i / 72 * Math.PI * 2, P = [rSn * Math.cos(a), rSn * Math.sin(a), 0];
        if (!kept(P)) { pen = false; continue; }
        const q = project(P);
        if (q[2] <= zN || q[0] < -W || q[0] > 2 * W || q[1] < -Hh || q[1] > 2 * Hh) { pen = false; continue; }
        if (pen && Math.hypot(q[0] - qPrev[0], q[1] - qPrev[1]) > 0.5 * Math.max(W, Hh)) pen = false;
        d += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true; qPrev = q;
        x0r = Math.min(x0r, q[0]); x1r = Math.max(x1r, q[0]);
        if (i < 72 && i % 3 === 0) pts.push(q);
      }
      const lt = ja() ? 'スノーライン' : 'snow line', lw = textW(lt), ringW = x1r - x0r, shown = ringW >= 40;
      const ringF = ss(40, 70, ringW), labF = ss(110, 160, ringW);
      let best = null, bestS = Infinity;
      for (const q of shown ? pts : []) {
        const bx = q[0] + 8, by = q[1] + 14;
        if (bx < 4 || bx + lw > W - 4 || by < 14 || by > Hh - 30) continue;   // (on the panel, clear of the scale bar)
        let n = 0;
        for (let k = 0; k < fieldPts.length; k += 2) { const x = fieldPts[k], y = fieldPts[k + 1]; if (x > bx - 3 && x < bx + lw + 3 && y > by - 13 && y < by + 4) n++; }
        const sc = n - 0.002 * q[1];   // (fewest lines, then the lowest)
        if (sc < bestS) { bestS = sc; best = q; }
      }
      ring.setAttribute('d', shown ? d : '');
      label.textContent = best && labF > 0 ? lt : '';
      const aop = annAmp.toFixed(3);
      ring.setAttribute('opacity', (ringA * ringF).toFixed(3)); label.setAttribute('opacity', (ringA * labF).toFixed(3));
      if (best) { label.setAttribute('x', best[0] + 8); label.setAttribute('y', best[1] + 14); }
      // the planet, named when it shows (close up)
      const pq = project(pPos), pa = ss(0.3, 0.6, pVis) * (kept(pPos) ? 1 : 0);
      plabel.textContent = pa > 0 && pq[2] > zN ? (ja() ? '惑星と周惑星円盤' : 'planet and its disk') : '';
      if (plabel.textContent) {
        const rc = 0.4 * (pV ? hillOf(pV) : PLANET.RH) / pq[2] * Hh / (2 * basis.th);   // radius of the planet's disk on the screen (px)
        plabel.setAttribute('x', (pq[0] + 0.75 * rc + 10).toFixed(1)); plabel.setAttribute('y', (pq[1] - 0.35 * rc - 12).toFixed(1)); plabel.setAttribute('opacity', (pa * annAmp).toFixed(2));
      }
      const QN = { T: ['温度', 'temperature'], rho: ['ガスの密度', 'gas density'], layers: ['磁場とガスの結びつきによる領域', 'the regions of how the field couples to the gas'] }[opt.sliceQ] || ['温度', 'temperature'];
      const CON = { chan: ['チャンネルマップ(' + opt.coV.toFixed(2) + ' km/s)', 'a channel map at ' + opt.coV.toFixed(2) + ' km/s'], m1: ['平均の視線速度(モーメント 1)', 'its mean velocity (moment 1)'], m0: ['積分強度(モーメント 0)', 'its integrated intensity (moment 0)'] }[opt.coMode];
      const cutJa = opt.cut === 'quarter' ? '右手前の 4 分の 1 を切り取り(右の切り口を正面から見る)' : '星を通る鉛直な面で手前の半分を切り取り', cutEn = opt.cut === 'quarter' ? ' The near right quarter is cut away (its right face seen face-on)' : ' The near half is cut away along a vertical plane through the star';
      const LKD = { optical: ['可視光・近赤外線の散乱光で見た姿で、星の光を散乱する表層と円盤風が見えます。', ' Seen in scattered light (visible and near infrared): the surface and the wind scatter starlight.'],
        mir: ['中間赤外線で見た姿で、暖かい表層の熱放射が内側ほど明るく見えます。', ' Seen in the mid-infrared: the warm surface glows, brightest close in.'],
        mm: ['ミリ波で見た姿で、赤道面に沈んだ小石の熱放射が、惑星のギャップのすぐ外の環とともに見えます。', ' Seen at millimetre wavelengths: the pebbles at the midplane glow, with a ring just outside the planet\u2019s gap.'] }[lookNow];
      const desc = ja()
        ? '原始惑星系円盤(半径30 au)のモデルを立体的に描いた図。表層は暖かく、赤道面は冷たく、ダストが赤道面に沈み、約1 auのスノーラインの外側で氷をまとっています。' + (plShown().length ? plShown().join(' au と ') + ' au に木星質量の惑星があり、ギャップを開けています。' : '') + (envVis > 0.5 ? '遠くからは、円盤を包むエンベロープと、軸に沿った空洞の明るい壁が見えます。' : '') + (opt.slice ? cutJa + '、切り口に' + QN[0] + 'を色で示しています。' : '') + (LKD ? LKD[0] : '') + (lookNow === 'co' ? 'ガスの輝線で見た姿で、' + CON[0] + 'を示しています。' : '')
        : 'Volume rendering of a model of a protoplanetary disk (30 au in radius): warm surface layers, a cold midplane with settled dust, and a water snow line near 1 au.' + (plShown().length ? (plShown().length > 1 ? ' Jupiter-mass planets at ' + plShown().join(', ') + ' au open gaps.' : ' A Jupiter-mass planet at ' + plShown()[0] + ' au opens a gap.') : '') + (envVis > 0.5 ? ' From afar, the infalling envelope shows, with the bright walls of a cavity along the axis.' : '') + (opt.slice ? cutEn + '; the cut faces show ' + QN[1] + ' in colour.' : '') + (LKD ? LKD[1] : '') + (lookNow === 'co' ? ' Seen in an emission line of the gas: ' + CON[1] + '.' : '');
      if (desc !== descEl.textContent) descEl.textContent = desc;
      const name = ja() ? '操作できる原始惑星系円盤のモデル' : 'Interactive model of a protoplanetary disk';
      if (canvas.getAttribute('aria-label') !== name) { canvas.setAttribute('aria-label', name); keysEl.textContent = ja() ? KEYS_JA : KEYS_EN; }
      // scale bar: 1 au (or a round multiple) at the distance of the star (of the planet when following it)
      const o = project(camT), r1 = project(camT.map((v, i) => v + basis.r[i])), pxAu = o[2] > zN ? Math.hypot(r1[0] - o[0], r1[1] - o[1]) : 0;
      let Lb = 0.005; for (const c of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]) if (c * pxAu <= 150) Lb = c;
      // (the clock's rate, slower zoomed in (clockK), is not written on the picture: Disk Lab says it beside its clock,
      // from diskframe's detail.clock)
      if (Lb !== sbLb) { if (sbLb && !reduce) { sbOld = sbLb; sbT = performance.now(); } sbLb = Lb; }
      const sbU = Math.min(1, (performance.now() - sbT) / 250), x0 = 18, y0 = Hh - 18;
      const bar = (g, L, a) => {
        const [hl, ln, tx] = g.children;
        if (L * pxAu > 320) a = 0;   // (the bar fading out after a big zoom would be drawn across the panel: not at all)
        for (const e of [hl, ln]) { e.setAttribute('x1', x0); e.setAttribute('x2', x0 + L * pxAu); e.setAttribute('y1', y0); e.setAttribute('y2', y0); }
        tx.textContent = pxAu > 0 && a > 0 ? L + ' au' : ''; tx.setAttribute('x', x0); tx.setAttribute('y', y0 - 6);
        g.setAttribute('opacity', (a * annAmp).toFixed(3));
      };
      bar(sgroup, Lb, sbU * sbU * (3 - 2 * sbU)); bar(sgroup2, sbOld, sbU < 1 ? 1 - sbU * sbU * (3 - 2 * sbU) : 0);
      if (fstats) {
        // the overlay's style and layout, forced here so that they are measured (otherwise done after the frame's script)
        const o1 = performance.now(); overlay.getBoundingClientRect(); const o2 = performance.now();
        fstats.draw.push(o1 - d0); fstats.over.push(o1 - o0); fstats.layout.push(o2 - o1);
      }
      // (Disk Lab v2: acc, the frames of the still picture so far, and accMax, the frames that complete it: a page can tell
      // a finished picture, and what one frame of it costs, from the frames it is made of. moving: the view is being
      // moved, a flight, a drag or a touch (viewMoving), which the state alone does not tell: it gives a flight's end.
      // clock: the clock's rate for the view, clockK, 1 far out and slower zoomed in)
      // (round 9: bands, the number of bands its volume was drawn in)
      box.dispatchEvent(new CustomEvent('diskframe', { detail: { time, years: time / 12, acc: accN, accMax: ACC_MAX, moving: viewMoving() ? 1 : 0, clock: clockK(), bands: job.n, held: Math.round(heldNow), ...(job.split ? { kicks: job.kicks || 0, bandPieces: job.bandPieces || 0 } : {}) } }));
      };
      // (a script's frame: its first band sent by the script, once the work before it is done and measured; see above)
      if (pre && adaptRows > 0) { job.defer = true; gl.flush(); return; }
      job.sentAt = performance.now();   // (round 9: a script's measure of its first band starts here, not before the frame's script)
      bandStep();
      if (reduce || (job.n === 1 && !job.ad && !job.stages && !job.split)) while (bandJob === job) { gl.flush(); bandStep(); }
    }
    // (round 9) a script's frame drawn by drawOnce with its first band held (job.defer): the work before it waited for and
    // reported ('<what> pre'), then the first band sent; returns the job (or null)
    async function firstBand(what) {
      const j = lastJob;
      if (!j || !j.defer || bandJob !== j) return j;
      const t = performance.now();
      await gpuDone(); if (lost) return null;
      piece(what + ' pre', performance.now() - t, null, { pre: 1 });
      j.defer = false;
      if (bandJob !== j) return j;   // (left meanwhile: a new scale)
      bandStep(); j.sentAt = performance.now();   // (from when its commands are sent: the script of its finish is not GPU work)
      return j;
    }
    // (round 9) The engine's own guard: the last word before any frame is sent, whatever asked for it (the page, a link, a
    // script calling diskSet, the keys, reduced motion's frames drawn at once). The page keeps the scale within its budget
    // (app.js, its guard, which climbs and holds); this one only steps in where a frame of what is about to be drawn is
    // predicted over GUARD_SLACK times the budget the page gave (diskGuard({ ms })): it lowers the scale at once, to
    // GUARD_FLOOR at least (at 0.1 the line's mean velocity lost the context, round 3), says so ('diskguard'), and where
    // even that is over, cuts the frame into bands. The prediction: a frame of this kind at scale 1 (gKnown, the median of
    // its last three measures, from the fences, kept 30 s), or the last kind measured times the ratio of their factors
    // (GFAC: measured on the M1 Max at the whole disk, rounded up; the cut GCUT more). Off (0) until the page sets it. Every
    // frame goes through it (round 9: diskSettle and diskCost too, which drew whole frames, 0.9 s in the cut at a fixed
    // level), but the measurements drawn whole on purpose, diskBench and diskRayProbe (fullFrame; each piece reported in
    // 'diskpiece'), the warm's pixel, and a snapshot's frames, which take at least the bands this guard asks for at its
    // start and the scale they were asked at.
    // (round 9, at its end: measured again with the stop rule, rec and the moments' passes, at the scales the guard then
    // draws: a frame of each kind at scale 1 as the guard counts it, c1 = ms / scale^2, over the model's at scale 1, rounded
    // up. They are higher than before (30, 18, 14, 75, 75): at the low scales these looks are drawn at, a frame is mostly
    // its floor (its slowest rays) and the costs that do not scale, which c1 counts as if they did: the visible look 68 ms
    // at 0.125, the moments 105 to 127 ms at 0.12 in two passes. Too high a factor draws the first frame of a look lower;
    // the guard then measures)
    const GFAC = { model: 1, mm: 0.6, optical: 100, mir: 36, 'co:chan': 46, 'co:m1': 170, 'co:m0': 200 }, GCUT = 3, GUARD_SLACK = 1.25, GUARD_FLOOR = 0.12;
    let gBudget = 0, gLast = { key: '', c1: 0 };
    const gKnown = {};
    const kindNow = () => lookNow + (lookNow === 'co' ? ':' + opt.coMode : '') + (opt.slice || sliceU > 0 ? ':cut' : '');
    const gFactor = (k) => (GFAC[k.replace(/:cut$/, '')] || 1) * (/:cut$/.test(k) ? GCUT : 1);
    const median3 = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    // (round 10a: a kind's own measure: of whole frames where there are fresh ones, else the upper bound from frames in bands)
    const ownC1 = (k) => { const kn = gKnown[k], now = performance.now(); return !kn ? 0 : kn.c.length && now - kn.t < 30000 ? median3(kn.c) : kn.tub && now - kn.tub < 30000 ? kn.ub : 0; };
    function gC1(k) {
      const own = ownC1(k);
      if (own > 0 && k === gLast.key) return own;
      const pred = gLast.c1 > 0 ? gLast.c1 * gFactor(k) / gFactor(gLast.key || 'model') : 0;
      return Math.max(pred, own);
    }
    // (round 10a: isF, a frame of the FULL program; see fNow)
    function gNote(k, ms, scale, n, band, isF = false) {
      if (!(scale > 0) || !(ms > 0)) return;
      // (a frame in bands: its longest band times their number, where bands run long; else their sum, a little over the
      // frame's cost, each band carrying the delay of the looks for its fence. Round 9: short bands were not noted, and a
      // look predicted dear from another's measure (GFAC, of the full march) kept the bands it was first given: the gas
      // line's mean velocity on the phone frame, 11 bands of 20 ms)
      // (round 10a) The sum of a frame in bands is only an upper bound of the frame drawn whole: each band pays the time of its
      // own slowest ray and its submission, which a whole frame pays once (16 bands of the model's frame at scale 1: 104 ms
      // against 25 ms in one piece, M1 Max). So it is kept apart (ub, the latest) and used only while no whole frame of the
      // kind has been measured lately: frames begun with the least band after every jump otherwise held the looks at scale
      // 0.125, the sums of their many small bands divided by the scale squared. A whole frame's measure takes over at once.
      // (Taking off each band's share of that fixed cost instead would underestimate frames whose bands carry equal work.)
      const c = (n > 1 && band > 2 * gBudget ? band * n : ms) / (scale * scale);
      const kn = gKnown[k] || (gKnown[k] = { c: [], t: 0, ub: 0, tub: 0, s: 0 });
      kn.s = scale;   // (round 10a: the scale it was measured at, see knownNow)
      // (round 10a: FULL's first measure of a kind replaces the usual program's, see fNow)
      if (isF && !kn.F) { kn.c = []; kn.ub = 0; kn.tub = 0; kn.F = true; }
      if (n > 1) { kn.ub = c; kn.tub = performance.now(); }
      else { kn.c.push(c); if (kn.c.length > 3) kn.c.shift(); kn.t = performance.now(); }
      gLast = { key: k, c1: ownC1(k) };
    }
    // (the bands the guard asks for this frame, 0 for none; set at the start of drawOnce)
    let gBands = 0, gFixed = false;
    function guardFrame() {
      gBands = 0;
      if (!(gBudget > 0) || fullFrame || snapping || warming) return;
      // (round 10a: a frame to be drawn in kicks is bounded by its kicks, a piece within the aim whatever the scale: not lowered
      // here, nor cut into the bands of whole rays. The page sets its scale: a still refined up to its level's, see app.js)
      // (only where the frame will be in kicks: FULL linked and warmed, its state made, not a measurement drawn whole; where FULL
      // failed to link the observed looks are drawn whole by the light program, and guarded here as before)
      if (splitOn && !reduce && !probing && !fullFrame && fullWarm && full && typeof full === 'object' && stT && splitLook() && !splitBroken[kindNow() + ':F']) return;
      // (round 9: a frame of the moments in passes, see coGrid, judged by a pass: its bands are the frame's shared among them)
      const parts = Math.max(1, coPassesNow()), k = kindNow(), c1 = gC1(k) / parts, p0 = c1 * opt.scale * opt.scale;
      if (!(p0 > GUARD_SLACK * gBudget)) return;
      // (round 10a, dev.5: where the page keeps the scale (gFixed: a fixed level, or the ramp, the view at rest; not the gas line's
      // look), a frame over the budget is cut into bands, never drawn at a lower scale: each band within the budget, the frame as
      // long as it takes. Bands of whole rays: not for a look whose single ray is over the budget, the gas line's)
      if (gFixed) { gBands = parts * Math.min(Math.max(1, Math.floor(rH / BAND_ROWS)), Math.ceil(2 * p0 / gBudget)); return; }
      // (a frame the page has cut into bands, a paused still: judged by its longest band, the one across the disk taken at
      // twice the mean as the page plans them; over, more bands rather than a lower scale, which the page sets back for a
      // still: round 9, a paused picture in the visible look was lowered here and set back every frame, never finished)
      if (stillBands > 1) {
        const rows = Math.max(1, Math.floor(rH / BAND_ROWS)), need = Math.ceil(2 * p0 / gBudget);
        if (2 * p0 * parts / Math.min(stillBands, rows * parts) <= GUARD_SLACK * gBudget) return;
        if (need <= rows) { gBands = need * parts; return; }
      }
      const to = Math.max(GUARD_FLOOR, Math.sqrt(gBudget / c1));
      if (to < opt.scale - 1e-3) {
        opt.scale = Math.round(to * 1000) / 1000; rescale();
        // (told after this frame's script, not inside it: the page's answer may set the scale again)
        const detail = { key: k, scale: opt.scale, c1 };
        Promise.resolve().then(() => box.dispatchEvent(new CustomEvent('diskguard', { detail })));
      }
      const pred = c1 * opt.scale * opt.scale;
      if (pred > GUARD_SLACK * gBudget) gBands = parts * Math.ceil(2 * pred / gBudget);
    }
    // (round 9) the next band of the frame in bandJob, and the frame's finish after its last; true while bands remain
    let bandJob = null, lastJob = null;
    // (round 9, for checks: each band timed on the GPU when diskGpuTime is on, its finish with it)
    function bandStep() {
      const j = bandJob, q = j && !lost ? gtBegin() : null;
      if (j && !lost) recBand(j);
      try { return bandStepIn(); } finally { if (q) lastBandGt = gtNote(gtEnd(q), { what: 'band', key: j.key, first: j.first ? 1 : 0, from: gtFrom(), sc: opt.scale, ...(j.split ? { kicks: j.lastKicks, K: j.K, rows: j.bd ? j.bd.y1 - j.bd.y0 : j.sent, bp: j.bd ? j.bd.pieces : 0, ...(j.stages ? { kk: j.kk, si: j.si } : {}) } : { rows: j.sent }) }); }
    }
    // (round 10a) A band about to be sent, told to the recorder (see rec) when it is dear: predicted over DEAR of the budget
    // (from the guard's cost of its kind, or, for a band sized as it goes, its dearest rows so far: near the budget, where a
    // misjudged piece would be long), a first use, or with no prediction (no budget yet, or the kind not measured since a
    // jump); its id goes with its fence (lastRid, j.rid), and its end is told with the same id (gpuPoll, piece). (0.4 told
    // every frame of Best's model look on the M1 Max, each written down at once: the frames well within the budget are
    // left to the page's summary of each kind)
    const DEAR = 0.8;
    let lastRid = 0, lastRect = null;
    function recBand(j) {
      lastRid = 0; j.rid = 0;
      if (benching) return;   // (diskBench's frames, timed and reported on their own: 'diskpiece' bench)
      if (!j.id) j.id = ++recId;
      const k = j.key.replace(/:F$/, ''), c = gKnown[k] && gKnown[k].c.length ? gC1(k) : 0;
      const sg = j.stages ? j.stages[j.si] : null, parts = j.stages ? j.stages.length - 1 : 1;
      // (round 10a: a frame in kicks, see SPLIT: the band in hand, or the next)
      const bdN = j.split && j.bd && !j.bd.done ? j.bd : null;
      const rows = bdN ? bdN.y1 - bdN.y0 : j.split ? Math.max(1, Math.min(rH - (j.y || 0), j.ad ? j.rows : Math.ceil(rH / Math.max(1, j.n)), stateRows()))
        : j.ad && !(sg && sg.p === 3) ? Math.max(1, Math.min(rH - (j.y || 0), j.rows)) : rH / Math.max(1, sg ? (sg.p === 3 ? 1 : j.nb) : j.n);
      // (round 10a, dev.5: a band sized as it goes with no row measured yet in this frame, from its kind's cost too: with the clock
      // running at rest in bands (the ramp), every band of the model's look was told as unpredicted, written down at once, 10 times
      // a second)
      const pred = j.ad && j.st && j.st.perRow > 0 ? j.st.perRow * rows : c > 0 ? c * opt.scale * opt.scale * rows / rH / parts : 0;
      // (the rows the band covers, as bandStepIn will scissor them: [y0, y1) of the volume's rH, the full width rW; drawn
      // into the lower left rW x rH of accT and shown stretched over the canvas)
      const nb = sg ? (sg.p === 3 ? 1 : j.nb) : j.n, y0 = bdN ? bdN.y0 : j.split || (j.ad && !(sg && sg.p === 3)) ? (j.y || 0) : Math.floor(rH * (j.b || 0) / nb);
      lastRect = [y0, Math.min(rH, Math.round(y0 + rows)), rW, rH];
      if (gBudget > 0 && pred > 0 && !j.first && pred <= DEAR * gBudget) return;
      // (round 10a: a piece of a frame in kicks, once its kind's kicks are measured, is as many kicks as fit in half the budget
      // (splitStep): not dear. Told as one with no prediction, each piece was written down at once by the page, some 24 times a
      // second in the visible look on a phone's frame, a localStorage write each)
      if (j.split && !j.first && kickMs(j.kk || j.key, j.K)) return;
      lastRid = j.rid = ++recId;
      rec({ k: 'piece', ph: 0, id: lastRid, job: j.id, key: j.key, sc: opt.scale, b: j.pieces || 0, n: j.n, pred: Math.round(pred), first: j.first ? 1 : 0, s: snapping ? 'snap' : stepping ? 'script' : '', rows: lastRect });
    }
    function bandStepIn() {
      const j = bandJob;
      if (!j || lost) { bandJob = null; return false; }
      if (j.split) return splitStep(j);   // (round 10a: see SPLIT)
      // (round 9: a frame of the moments in passes, see coGrid: the stage now, its target, its uniforms; a group pass reads
      // the other float target, never the one it draws into)
      const sg = j.stages ? j.stages[j.si] : null, last = !sg || sg.p === 3;
      const tg = sg && sg.p === 2 ? coAccT[sg.out] : probing === 2 && probeT ? probeT : testT || accT;   // (testT: diskSplitTest)
      gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb); gl.viewport(0, 0, rW, rH); gl.useProgram(j.prog);
      if (sg) {
        gl.uniform1i(j.U.uCoPass, sg.p); gl.uniform1i(j.U.uCoG0, sg.g0 || 0);
        gl.uniform1i(j.U.uProbe, probing === 1 && sg.p === 2 ? (j.probeAt === j.si ? 1 : 0) : probing);
        gl.activeTexture(gl.TEXTURE0 + CO_UNIT); gl.bindTexture(gl.TEXTURE_2D, coAccT[sg.p === 2 ? 1 - sg.out : sg.in].tex); gl.activeTexture(gl.TEXTURE2);
      }
      if (j.acc && last) { gl.enable(gl.BLEND); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); gl.blendColor(0, 0, 0, 1 / (j.acc + 1)); }
      const nb = sg ? (sg.p === 3 ? 1 : j.nb) : j.n;
      if (j.ad && !(sg && sg.p === 3)) {
        const y1 = Math.min(rH, j.y + Math.max(1, j.rows));
        gl.enable(gl.SCISSOR_TEST); gl.scissor(0, j.y, rW, y1 - j.y); j.sent = y1 - j.y; j.y = y1;
      } else if (nb > 1) {
        const y0 = Math.floor(rH * j.b / nb), y1 = Math.floor(rH * (j.b + 1) / nb);
        gl.enable(gl.SCISSOR_TEST); gl.scissor(0, y0, rW, y1 - y0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND);
      j.sentStage = j.si || 0; j.pieces = (j.pieces || 0) + 1;
      const stageDone = j.ad && !(sg && sg.p === 3) ? j.y >= rH : ++j.b >= nb;
      if (j.ad && !(sg && sg.p === 3)) j.b++;
      if (!stageDone) return true;
      if (sg && j.si < j.stages.length - 1 && !(probing === 1 && j.probeAt === j.si)) { j.si++; j.b = 0; j.y = 0; return true; }
      if (j.ad || sg) j.n = j.pieces;
      if (j.ad && j.st && j.st.prof && !j.stages) j.st.full = true;   // (round 10a: its rows' costs known, for the next frame, see rowsAfter)
      bandJob = null;
      if (sg && probing === 1) return false;   // (the probe's counts: the frame not finished)
      // (round 10a: the volume's last band sent on its own before the finish (the glow, the display, the measurements), so
      // that no command buffer holds more than one piece of the frame's work: WebKit bug 290752, iOS 18.2 and later stop a
      // command buffer with too much work in it, and ANGLE never splits one; each gl.flush ends one)
      gl.flush();
      j.finish();
      return false;
    }
    // (round 9) the moments' float targets (see coGrid), two read and drawn into in turn: full floats where they can be
    // drawn into, half floats otherwise (the sums are kept scaled for those, CO_SUM)
    const CO_UNIT = 17, CO_FMT = fbFloat ? gl.RGBA32F : gl.RGBA16F;
    const coAccT = [null, null];
    let coProbeAt = -1;   // (diskRayProbe: the pass whose counts are written; the frame ends there)
    function coAccOf() {
      for (let i = 0; i < 2; i++) {
        const t = coAccT[i];
        if (t && t.w >= rW && t.h >= rH) continue;
        if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
        // (round 10a: NEAREST, read only by texelFetch: with LINEAR the 32-bit sums were an incomplete texture on iPhones,
        // read as (0, 0, 0, 1) by the moments' passes after the first; see target)
        coAccT[i] = target(Math.max(rW, t ? t.w : 1), Math.max(rH, t ? t.h : 1), CO_FMT, gl.CLAMP_TO_EDGE, gl.NEAREST); glErr('co sums');
      }
    }
    // (round 9) the number of bands for a new frame: a snapshot's own (snapBands) while one is drawn; else those the page
    // asks for (diskBands: a still picture drawn at a high scale, whose frame may take several times a running frame; or
    // a look so dear on a slow GPU that even the lowest scale is over the page's budget). A measurement drawn whole on
    // purpose (diskBench, diskRayProbe: fullFrame) is never cut. A frame in bands is drawn to its end whatever changes
    // meanwhile (the clock, a drag, a fade): it holds the state of its first band, and the next frame takes the state of
    // then; left unfinished, a frame in bands redrawn on every change would never be shown.
    let stillBands = 1, stillBandMs = 0, snapping = false, fullFrame = 0, pageBands = 1, stepping = 0;
    // (at least BAND_ROWS rows a band: a band's time has a floor of its own, the longest ray in it: in the visible look, whose
    // continuum is marched in up to 32768 steps a ray, some 60 ms on the M1 Max at any scale, so more bands do not help)
    const BAND_ROWS = 8;
    // (round 9) A script's frames (diskSettle, diskCost, diskSnapshot) each band waited for, so each band's time is known
    // before the next is sent: its rows are sized from the dearest rows so far (rowsAfter), aiming at half the budget (the
    // page's, or a snapshot's bandMs). The first band of a script's first frame takes an eighth of the rows at most: the
    // engine's prediction of a view not yet measured may be far off (round 9's checks: next to the star, a snapshot band
    // of 418 ms and a settling frame of 310 ms after a jump from the dead zone's cut). adaptRows: the first band's rows
    // for the next frame drawn, 0 for frames of fixed bands (the animation frames)
    let adaptRows = 0;
    // (round 9) A jump (diskSet: the view set at once, or the look, the line's map, the cut, the components, the wind's side,
    // the waves changed) leaves the cost of the next frames unknown: the guard's measures are by the kind of frame, and one
    // kind costs up to six times more in one view than in another (the model's look at scale 1 on the M1 Max: 60 ms at the
    // snow line, some 350 ms at the planet close up). Round 9's checks: a 493 ms frame at scale 1 after a jump between the
    // places, where Best had climbed to 1. So the measures before are dropped, and the next PROBE_FRAMES animation frames
    // are drawn in bands sized as they go (the first an eighth of the rows; each sent once the one before is done, so its
    // time is known): no piece of work is long whatever the frame costs, and its cost is measured for the guard
    const PROBE_FRAMES = 2;
    // (and the first frames of a start, or of a context given back: nothing is measured yet)
    let probeNext = PROBE_FRAMES, lastBand = { j: null, ms: 0 };
    // (round 10a) A band sized as it goes: from the dearest rows measured so far, aiming at `aim`, as before; but at most twice
    // the rows of the band before (the rows ahead may be far dearer than those measured: the disk after the sky, a few
    // ms a row against hundredths), and within the guard's bands (gBands). Round 10a's checks: a script's frame of the
    // visible look at scale 1, its first band an eighth of the rows (99 of 792), took 655 ms on the M1 Max
    // (and, where the frame before of the same picture left its cost row by row (st.prof: each band's time spread over its
    // rows; a still's frames are the same view, jittered), the rows ahead taken from it until they add up to `aim`: bands cut
    // where they cost the same, the disk's in thin bands, the sky's in thick ones)
    const rowsAfter = (st, j, ms, aim) => {
      if (j && j.ad && j.sent > 0 && ms > 0) {
        st.perRow = Math.max(st.perRow || 0, ms / j.sent);
        if (st.prof && !j.stages) st.prof.fill(ms / j.sent, Math.max(0, j.y - j.sent), j.y);
      }
      let r;
      if (st.full && st.prof && j && !j.stages) { let sum = 0, y = j.y; while (y < rH && sum + st.prof[y] <= aim) sum += st.prof[y++]; r = y - j.y; }
      else {
        r = st.perRow > 0 ? Math.floor(aim / st.perRow) : Math.ceil(rH / 8);
        if (j && j.sent > 0) r = Math.min(r, 2 * j.sent);
      }
      if (gBands > 0) r = Math.min(r, Math.ceil(rH / gBands));
      return Math.max(BAND_ROWS, r);
    };
    // (round 10a) the rows of a frame's first band from the profile of the frame before (see rowsAfter), or firstRows
    const firstRowsOf = (st, aim) => {
      if (!(st.full && st.prof)) return firstRows(aim);
      let sum = 0, y = 0; while (y < rH && sum + st.prof[y] <= aim) sum += st.prof[y++];
      return Math.max(BAND_ROWS, Math.min(y, gBands > 0 ? Math.ceil(rH / gBands) : rH));
    };
    // (round 10a) the state of the frames in bands of one picture (its kind, size), kept from frame to frame: see drawOnce
    let stillSt = null;
    // (round 10a) The first band of a frame sized as it goes (a script's, or the first frames after a jump): where this kind
    // of frame has been measured on this device since the last jump (gKnown, fresh), the rows its cost per row at this
    // scale allows within `aim`; where it has not (a look, a line's map or a cut not yet drawn since the jump, a march's tier
    // changed, a context given back: nothing to trust), the least band, BAND_ROWS, the next ones growing from the measures
    // (rowsAfter). Within the guard's bands (gBands) either way
    // (round 10a) fNow: the frame about to be drawn is FULL's (set in drawOnce). A kind measured by the usual program only is
    // not known for FULL's frames: the checks session saw the first frames of the cut at the heat place drawn whole at the
    // start, 181 to 205 ms at scales 1 and 0.8 on the M1 Max (desktop budget 120), the cut's kind measured by the usual
    // program's frames while FULL was being linked (the cut left out of them), two to three times cheaper
    let fNow = false;
    // (round 10a, the coordinator: and measured at the scale drawn: a frame is drawn whole only from a measure of its own scale.
    // The checks' start at the cut (heat, desktop): measured at 0.5, the cut's frame at 0.63 drawn whole was predicted 108 ms
    // and took 185 to 235 (dev.3: 101, 109); a measure at another scale now sizes nothing, the frame's bands sized as they go
    // from the least, and its measure at this scale taken)
    const knownNow = (k) => ownC1(k) > 0 && (!fNow || !!(gKnown[k] && gKnown[k].F)) && Math.abs((gKnown[k].s || 0) - opt.scale) < 0.004;
    const firstRows = (aim) => {
      const k = kindNow(), kn = gKnown[k], trusted = knownNow(k);
      let r = BAND_ROWS;
      if (trusted) { const perRow = ownC1(k) / Math.max(1, coPassesNow()) * opt.scale * opt.scale / rH; r = perRow > 0 ? Math.floor(aim / perRow) : rH; }
      if (gBands > 0) r = Math.min(r, Math.ceil(rH / gBands));
      return Math.max(BAND_ROWS, Math.min(rH, r));
    };
    let adaptAim = 0;   // (the aim of a frame sized as it goes, for its first band: a script's; 0, half the budget)
    const bandsFor = () => (fullFrame ? 1 : snapping ? snapBands : Math.min(Math.max(stillBands, gBands), Math.max(1, Math.floor(rH / BAND_ROWS))));
    // what a frame costs depends on (beyond its pixels): the look (and the line's map), the cut, the FULL program
    const frameKeyOf = (F) => kindNow() + (F ? ':F' : '');
    // a clump that crosses the snow line releases vapor
    function update() {
      snowNow();
      for (const c of clumps) {
        if (c.amp <= 0) continue;
        if (time < c.t0) { c.amp = 0; continue; }   // (the clock set back before its drop: gone)
        const Rc = c.R - 0.05 * (time - c.t0);
        if (!c.crossed && Rc < rSn) {
          c.crossed = true;
          const tc = c.t0 + (c.R - rSn) / 0.05;
          const v = vapor.reduce((a, b) => (a.amp <= 0 || a.t0 < b.t0 ? a : b));
          v.R = 0.88 * rSn; v.phi = c.phi + Omega(rSn) * (tc - c.t0); v.t0 = tc; v.amp = c.amp;
        }
        if (Rc < 0.08 || time - c.t0 > 120) c.amp = 0;
      }
      for (const v of vapor) if (v.amp > 0 && (time - v.t0 > 30 || time < v.t0)) v.amp = 0;
    }
    // a flight, a fade or the sweep under way
    const plShown = () => planets.filter((p) => p.amp > 0.5).map((p) => +p.a.toFixed(p.a < 10 ? 1 : 0));
    const busy = () => !!(flyV || flyT) || planets.some((p) => p.amp !== plWant(p)) || envAmp !== ((opt.mode & 32) ? 1 : 0) || sliceU !== (opt.slice ? 1 : 0) || (sliceU > 0 && cutA !== CUT_A[opt.cut])
      || annAmp !== (opt.ann ? 1 : 0) || lookNow !== opt.look || waitShown || lookDip() < 1 || fieldAmp !== (showField && lookNow === 'model' ? 1 : 0) || !fadesDone()
      || (!aeHeld() && aeGoal !== aeLn) || coGoal !== coLn           // (the automatic exposure and the CO line's range on their way,
      || (aeOn() && !aeHeld() && !aeFresh) || (coOn() && !coHold && coSavedKey !== coKey && !coFresh) || !!coPending;  // or finding their levels)
    // Disk Lab v2 (engine-patch.py): at most data-flight (default 2; 0: no limit) frames of this loop unfinished on the
    // GPU. Animation frames come faster than the GPU finishes them, and Chrome then holds frames of work in its queue: a
    // drag reaches the screen late, and every call that must wait for the GPU (the exposure's readback) waits behind the
    // whole queue. A frame is drawn only while fewer are in flight; otherwise this animation frame passes (the clock
    // moves on, the picture waits for the next one).
    const flight = [];
    const gpuBehind = (limit) => {
      gpuPoll();
      const n = limit || (box.dataset.flight == null ? 2 : Math.round(Number(box.dataset.flight)));
      return n > 0 && flight.reduce((k, f) => k + (f.pre ? 0 : 1), 0) >= n;   // (round 9: a frame's work before its volume not counted apart)
    };
    // (round 9) What each frame costs the GPU, on any device (Safari has no GPU timer queries): each piece of work sent
    // (a frame, or a band of one) carries a fence and the time it was sent; the time it is done, less the later of its
    // sending and the end of the piece before (the GPU was busy with that one until then), is its busy time. It is looked
    // for in the animation frames, and every GPU_LOOK ms while work is in flight, and taken halfway between the last look that
    // found it not done (or its sending) and the one that found it done, so that a light frame is not counted as a whole
    // interval between looks. A frame's total (its bands summed) goes to the page in a 'diskgpu' event: ms, the longest
    // piece (band), the bands, the volume's pixels (px) and scale, and its kind (key: the look, the line's map, the cut,
    // the FULL program), from which the page predicts the cost of what it is about to ask for (DESIGN.md, section 22).
    // Pieces found done more than GPU_STALE ms after they were sent, or with the page hidden meanwhile, are not counted
    // (their time is the wait for the page, not the GPU's). A still picture's frames drawn in bands (diskBands) that take
    // more than twice the time asked for a band are cut into more bands from the next frame.
    // (GPU_LOOK: ms between the looks while work is in flight; a few more wakings of the page than frames, a small price
    // beside the GPU's work, and the measure of a frame good to about half of it)
    // (round 10a) HUNG_MS: a piece of work not done this long after it was sent, while the page still runs (its animation
    // frames or its timers), is told to the recorder as hung, once; its end, if it comes, as late. A GPU that has stopped
    // and a page whose script is blocked look alike from outside: this tells them apart (if the page stops too, the
    // recorder's last step is the one in flight)
    const GPU_STALE = 4000, GPU_LOOK = 8, HUNG_MS = 2500;
    let lastPreMs = -1;
    // (round 10a) a pass drawn for the first time in this build (a program in a state the GPU's process must make a pipeline
    // for), told to the recorder with when
    const firstSeen = new Set();
    const firstUse = (w) => { if (!firstSeen.has(w)) { firstSeen.add(w); rec({ k: 'first', w }); } };
    // (round 10a) measures taken while the page was hidden are its timers' delays, not the GPU's: a script's frame measured
    // across a change of visibility is not noted (round 10a's checks: a tab put behind another for 12 minutes read 1.6 s a band)
    let visGen = 0;
    document.addEventListener('visibilitychange', () => { visGen++; }, on);
    // (round 10a) The GPU's duty (diskDuty): where the page asks for it (a guarded device), a frame that only moves the clock on,
    // and the next band of a still being refined, wait until the GPU has been idle for (1 / duty - 1) times the work just done.
    // The owner's iPhone (A18, four GPU cores) reset its GPU ("firmware-detected lockup") after some 20 s of the visible look
    // at 20 frames a second whose frames took up to 55 ms each: the GPU never idle. 0: none (as before)
    let duty = 0, lastGpuFrame = 0, bandRestUntil = 0, ctMax = 32768, probeJit = false;
    let gpuEnd = 0, gpuSum = 0, gpuMax = 0, gpuBad = false, gpuTimer = 0, gpuLook = 0, gpuFirst = false, gpuStages = [], gpuPre = 0, gpuVolMax = 0;
    // (round 10a, the march in kicks: a frame's dearest kick, its piece's time over its kicks (a piece of one kick, that kick's
    // time), for the flight record, so that a phone's record says what its kicks cost; and the dearest so far by kind)
    let gpuKick = 0, gpuKick1 = 0, gpuOut = false;
    // (a frame's measures from its pieces' fences, gathered until its last piece: begun anew there, and at a frame left)
    const gpuReset = () => { gpuSum = 0; gpuMax = 0; gpuBad = false; gpuFirst = false; gpuOut = false; gpuStages = []; gpuPre = 0; gpuVolMax = 0; gpuKick = 0; gpuKick1 = 0; };
    const kickWorst = {};
    let fenceN = 0;
    box.diskFenceLog = (on) => { if (on != null) fenceLog = !!on; return fenceLog; };
    // (out: a frame drawn outside the animation frames, see drawOut: fenced, its time told, but not a measure of what its kind
    // costs: drawn at a resize, its view and program may not be those of the frames that follow, round 10a's start at the cut)
    const fence = (end, j, out = false) => {
      const ts = performance.now(), sy = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); slowSync('fenceSync', ts);
      flight.push({ s: sy, t: performance.now(), end, n: j ? j.n : 1, px: rW * rH, scale: opt.scale, key: j ? j.key : '', still: paused, first: !!(j && j.first), j, st: j && j.stages ? j.sentStage : null, gt: lastBandGt, rid: lastRid, rect: lastRect, kicks: j && j.split ? j.lastKicks || 0 : 0, out,
        ...(fenceLog ? { rows: j ? (j.split && j.bd ? j.bd.y1 - j.bd.y0 : j.sent) : rH, bp: j && j.split && j.bd ? j.bd.pieces : 0, fid: ++fenceN, warm: { linked: !!full, sent: fullWarm, pending: !!warmSync }, reduce: reduce ? 1 : 0 } : {}) });
      if (fenceLog && lastBandGt) lastBandGt.fid = fenceN;
      if (lastBandGt) lastBandGt.att = 1;   // (for 'nofence': its fence sent)
      lastBandGt = null; lastRid = 0; lastRect = null;
      gl.flush();
      if (!gpuTimer) gpuTimer = setTimeout(gpuTick, GPU_LOOK);
    };
    function gpuTick() {
      gpuTimer = 0; if (lost) return; gpuPoll();
      // (round 10a, optimizing a still's time to its full scale: its next piece in kicks sent as soon as the GPU is done with the
      // last and its rest (the duty) is over, here, not at the next animation frame: a still has no frame rate to keep, and on
      // the phone's frame as WebKit on a GPU six times slower a piece took some 6 ms of a 16 ms animation frame. The same tests
      // as the animation frames' (frame); fence sets the next look)
      if (bandJob && bandJob.still && bandJob.split && running && !benching && !snapping && !stepping && !warmSync && !gpuBehind(1) && !(duty > 0 && performance.now() < bandRestUntil) && splitReady(bandJob)) {
        const j = bandJob; bandStep(); fence(!bandJob, j);
      }
      if (flight.length && !gpuTimer) gpuTimer = setTimeout(gpuTick, GPU_LOOK);
      // (its rest not over: looked at again when it is)
      else if (!gpuTimer && bandJob && bandJob.still && bandJob.split && running && duty > 0 && performance.now() < bandRestUntil) gpuTimer = setTimeout(gpuTick, bandRestUntil - performance.now() + 1);
    }
    // (round 10a, dev.6: a read that waited for the GPU, begun at ts: the pieces sent before it were done by its end)
    function gpuDrained(ts) { const end = performance.now(); for (const f of flight) if (f.t <= ts && f.doneBy == null) f.doneBy = end; gpuPoll(); }
    function gpuPoll() {
      if (lost) return;
      const now = performance.now();
      const waitOne = () => { const ts = performance.now(), r = gl.clientWaitSync(flight[0].s, 0, 0); slowSync('clientWaitSync', ts); return r; };
      while (flight.length && waitOne() !== gl.TIMEOUT_EXPIRED) {
        const f = flight.shift(); gl.deleteSync(f.s);
        const from = Math.max(f.t, gpuEnd), done = Math.max(from, Math.min(f.doneBy || Infinity, 0.5 * (Math.max(gpuLook, from) + now)));
        const ms = done - from;
        gpuEnd = done; lastBand = { j: f.j, ms };
        // (round 10a: the end of a piece told to the recorder, or of one told as hung; and the work before the volume's time,
        // for whether the next is dear)
        if (f.rid) rec({ k: 'piece', ph: 1, id: f.rid, ms, late: f.hung ? 1 : 0, ...(f.pre ? { pre: 1 } : {}) });
        else if (f.hung) rec({ k: 'late', key: f.key, ms: now - f.t, pre: f.pre ? 1 : 0 });
        if (f.pre) lastPreMs = ms;
        if (duty > 0 && !f.pre && f.j && (f.j.ad || f.j.split)) bandRestUntil = now + ms * (1 / duty - 1);   // (round 10a: see duty)
        if (!f.pre && f.j && f.j.split) { f.j.bandMs = (f.j.bandMs || 0) + ms; f.j.lastMs = ms; }   // (round 10a: a band's pieces, see SPLIT)
        if (f.gt) { f.gt.fence = ms; f.gt.what = f.pre ? 'pre' : 'frame'; }   // (round 9: see diskGpuTime)
        // (round 10a, dev.6, for checks: each piece's fence where there are no timers, box.diskFenceLog(true))
        if (fenceLog) box.dispatchEvent(new CustomEvent('diskfence', { detail: { ms: Math.round(ms * 10) / 10, wait: Math.round((from - f.t) * 10) / 10, key: f.key, pre: f.pre ? 1 : 0, first: f.first ? 1 : 0, end: f.end ? 1 : 0, kicks: f.kicks, rows: f.rows, bp: f.bp, sc: f.scale, out: f.out ? 1 : 0, left: f.j && f.j.cancelled ? 1 : 0,
          fid: f.fid, n: f.n, warm: f.warm, reduce: f.reduce, sent: Math.round(f.t * 10) / 10, seen: Math.round(now * 10) / 10, lookBefore: Math.round(gpuLook * 10) / 10,
          syncs: syncLog.filter((x) => x.t0 + x.ms >= f.t - 0.05 && x.t0 <= now) } }));
        // (round 10a, dev.6: a piece of a frame left (a jump: cancelJob; a new size) is not the next frame's. Its time went into the
        // next frame's measures: the guard's cost of that kind, and its longest piece as the checks read it where there are no
        // timers. In the frame as WebKit on a GPU six times slower, the model's last band in flight at the jump to the visible
        // look was counted as the visible look's first frame's longest piece, 117 to 143 ms (times 6), where that look's own
        // pieces were 8 ms (4 kicks) and 2 (1 kick). The frame's measures gathered before are dropped with it, see frameLeft)
        if (f.j && f.j.cancelled) continue;
        if (f.st != null) gpuStages[f.st] = (gpuStages[f.st] || 0) + ms;   // (round 9: a frame in passes, each pass's time)
        if (f.pre) gpuPre += ms;   // (round 9: the work before the volume, see drawOnce)
        if (now - f.t > GPU_STALE || document.hidden) gpuBad = true;
        gpuSum += ms; gpuMax = Math.max(gpuMax, ms); gpuFirst = gpuFirst || f.first; gpuOut = gpuOut || !!f.out;
        if (!f.pre) gpuVolMax = Math.max(gpuVolMax, ms);
        if (f.kicks > 0 && !f.first && now - f.t <= GPU_STALE && !document.hidden) {
          gpuKick = Math.max(gpuKick, ms / f.kicks); if (f.kicks === 1) gpuKick1 = Math.max(gpuKick1, ms);
          const w = kickWorst[f.key] || (kickWorst[f.key] = { avg: 0, one: 0 });
          w.avg = Math.max(w.avg, Math.round(ms / f.kicks * 10) / 10); if (f.kicks === 1) w.one = Math.max(w.one, Math.round(ms * 10) / 10);
        }
        if (!f.end) continue;
        // (bands, or whole frames, that run past twice the time asked for one: more bands for the next frames; not where the
        // bands are already short on the whole, which more of them would not shorten: each has a cost of its own)
        if (stillBandMs > 0 && !gpuBad && !gpuFirst && gpuMax > 2 * stillBandMs && gpuSum / f.n > 0.5 * stillBandMs && stillBands < 64) stillBands = Math.min(64, Math.ceil(f.n * gpuMax / stillBandMs));
        // (and fewer again, down to the page's, where they run well short: round 9, the gas line's maps on the phone frame
        // kept 11 bands of 20 ms where 3 would do, a picture every 130 ms)
        else if (stillBandMs > 0 && !gpuBad && !gpuFirst && f.n > 1 && stillBands > pageBands) stillBands = Math.min(stillBands, Math.max(pageBands, Math.ceil(f.n * gpuMax / stillBandMs)));
        // (round 10a: the volume's cost alone: the work before it (the maps) is a piece of its own, sent and measured on its own,
        // and does not grow with the pixels; counted in, divided by the scale squared, it made a frame at 0.125 cost 3000 ms at
        // scale 1 in the millimetre look (maps of 50 to 90 ms after a jump), and the guard held the looks at their lowest scale)
        if (!gpuBad && !gpuFirst && !gpuOut) gNote(f.key.replace(/:F$/, ''), gpuSum - gpuPre, f.scale, f.n, gpuVolMax, /:F$/.test(f.key));
        // (first: a program's first use in a blend state, see warmFull; its time is mostly the pipeline's making)
        if (!gpuBad) box.dispatchEvent(new CustomEvent('diskgpu', { detail: { ms: Math.round(gpuSum * 10) / 10, band: Math.round(gpuMax * 10) / 10, vband: Math.round(gpuVolMax * 10) / 10, bands: f.n, px: f.px, scale: f.scale, key: f.key, still: f.still ? 1 : 0, next: stillBands, first: gpuFirst ? 1 : 0, ...(gpuOut ? { out: 1 } : {}), pre: Math.round(gpuPre * 10) / 10, ...(gpuStages.length ? { stages: gpuStages.map((v) => Math.round((v || 0) * 10) / 10) } : {}), ...(f.j && f.j.split ? { kicks: f.j.kicks || 0, kick: Math.round(gpuKick * 10) / 10, kick1: Math.round(gpuKick1 * 10) / 10 } : {}) } }));
        if (!gpuBad) lastGpuFrame = gpuSum;   // (round 10a: see duty)
        gpuReset();
      }
      if (flight.length) gpuLook = now;
    }
    // (round 9, for checks) Each piece of work's own GPU time, where the browser has timer queries
    // (EXT_disjoint_timer_query_webgl2): off unless asked for (diskGpuTime(1); the page's ?gputime=1), the product's guard
    // keeps to the fences, whose times count the waits too (a lower scale: the safe side). Each piece (a band, with its
    // finish; the work before a volume; the warm) is timed by a query of its own; when the result and the piece's fence
    // time are both known, 'diskgputime' gives { what, key, first, gpu, fence } (ms), for the checks' tripwire: a piece's GPU
    // time over its limit trips it; a fence much longer than the GPU time is a wait, not our work (round 9's checks: 300 ms
    // with 20 ms of GPU work, another program on the machine). A timing during which the GPU was disjoint is dropped.
    // (on the box, data-gputime, so that an engine built anew after a restored context keeps it)
    let gtOn = box.dataset.gputime === '1', gtExt = null, gtCur = null, gtTimer = 0, lastPreGt = null, lastBandGt = null, lastWarmGt = null;
    const gtPend = [];
    function gtBegin() {
      if (gtOn && !gtExt) gtExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!gtOn || !gtExt || gtCur || benching || lost) return null;
      const q = gl.createQuery(); gl.beginQuery(gtExt.TIME_ELAPSED_EXT, q); gtCur = q; return q;
    }
    function gtEnd(q) { if (q && gtCur === q) { gl.endQuery(gtExt.TIME_ELAPSED_EXT); gtCur = null; } return q; }
    function gtNote(q, info) {
      if (!q) return null;
      const e = { q, ...info, t: performance.now(), fence: null };
      gtPend.push(e); if (!gtTimer) gtTimer = setTimeout(gtTick, 16);
      return e;
    }
    const GT_NOFENCE = 10000;
    // (where a timed piece was sent from, for 'nofence': the callers, while the timer queries are on (the checks))
    const gtFrom = () => (new Error().stack || '').split('\n').slice(3, 7).map((l) => l.trim().replace(/^at /, '').replace(/ \(.*\)$/, '')).join(' < ');
    function gtTick() {
      gtTimer = 0;
      if (lost) { gtPend.length = 0; return; }
      const disjoint = gl.getParameter(gtExt.GPU_DISJOINT_EXT), now = performance.now();
      for (let i = 0; i < gtPend.length;) {
        const e = gtPend[i];
        if (e.res == null && gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) { e.res = disjoint ? -1 : gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(e.q); }
        // (sent once its fence time is known too, or after GT_NOFENCE ms without it. Round 10a: every piece of work sent has a
        // fence (its frame's, or a script's wait for the GPU), so one without is an error, told to the recorder ('nofence'):
        // the round's checks tripped on a piece whose GPU time came with no fence after 2 s, the GPU time alone (it counts the
        // time a piece waited queued behind others, see check.js 0b), 336 ms)
        if (e.res != null && (e.fence != null || now - e.t > GT_NOFENCE)) {
          gtPend.splice(i, 1);
          // (whether its fence was sent (att), and the pieces in flight then, the oldest's age: a fence never sent, or one waited
          // behind another that did not pass)
          if (e.fence == null) rec({ k: 'nofence', w: e.what, key: e.key, gpu: Math.round(e.res * 10) / 10, age: Math.round(now - e.t), att: e.att ? 1 : 0, fl: flight.length, f0: flight.length ? Math.round(now - flight[0].t) : 0, from: e.from });
          if (e.res >= 0) box.dispatchEvent(new CustomEvent('diskgputime', { detail: { what: e.what, key: e.key, first: e.first, gpu: Math.round(e.res * 10) / 10, fence: e.fence == null ? null : Math.round(e.fence * 10) / 10, ...(e.fence == null ? { nofence: 1 } : {}), sc: e.sc, kicks: e.kicks, K: e.K, rows: e.rows, bp: e.bp, kk: e.kk, si: e.si, fid: e.fid } }));
          continue;
        }
        i++;
      }
      if (gtPend.length) gtTimer = setTimeout(gtTick, 16);
    }
    // (round 9) The frame rate's cap (diskFps, 0: none): while the clock runs and nothing else changes (the view at rest, no
    // fade or sweep, no input since the last frame: urgent, set by touched), a frame is drawn at most fpsCap times a second.
    // The slow turn of the disk does not need 60 (the owner: "the phone gets warm: does it use much power?"): the GPU drew
    // every display frame while the clock ran. The time a frame waited for the cap (heldNow, ms) goes with it in diskframe
    // (held), so that the page's governors count what the frames cost, not the cap's wait.
    let fpsCap = 0, capT0 = 0, lastDrawT = 0, heldNow = 0, urgent = false, rayBound = true, probing = 0, march = 'full';
    // (round 9) The march's tiers: 'full', the continuum in sixteenths of the step (the picture as checked against an
    // independent column solver); 'cheap', in quarters, for devices whose slowest ray is over their budget even at the lowest
    // scale (the page chooses: a guarded device starts with it, and any other switches to it when it measures so; see
    // app.js, the guard). DESIGN.md, section 22.
    // full: the gas line by rec (see CO_MARCH_GLSL) from a quarter of the geometric step, halved to 1/64 at most where the
    // test (0.04) asks, bounded at CO_IT; the continuum in sixteenths, bounded at CT_IT. cheap: the gas line by rec-c2 (the
    // design note's 8.2: from half the geometric step, the test at 0.12, to 1/64 at most), the continuum in quarters, its
    // substeps fewer from 512 iterations every 128 and its steps longer from 1024. (The cheaper tier of before, whole steps
    // and no halving, was off by 38 % in the channel map next to the star and by 0.63 km/s in M1.) r9: the full march as it
    // was before rec, for comparisons only (diskMarch('r9')).
    // coP: the moments' groups a pass (see coGrid): 3 where the budget allows (two passes, half the work of six), 1 in the
    // cheaper tier (six passes, the lowest floor a pass: a phone's)
    const MARCH = { full: { sub: 16, coStep: 0.25, coRef: 4, coThr: 0.04, coRec: 1, coP: 3, coIt: CO_IT, ctIt: [CT_IT[0], CT_IT[1], CT_IT[2]] },
      cheap: { sub: 4, coStep: 0.5, coRef: 5, coThr: 0.12, coRec: 1, coP: 1, coIt: CO_IT, ctIt: [512, 128, 1024] },
      r9: { sub: 16, coStep: 0.25, coRef: 4, coThr: 0.04, coRec: 0, coP: 3, coIt: [512, 1024, 256], ctIt: [CT_IT[0], CT_IT[1], CT_IT[2]] } };
    // the moments' passes of a frame now: the group passes, then the composite (0 where the look is not the moments)
    const coPassesNow = () => (lookNow === 'co' && opt.coMode !== 'chan' && full ? CO_Q / MARCH[rayBound ? march : 'full'].coP : 0);
    // (one animation chain: the queued callback is owned, so that stop and start cannot leave a second one; from dc55d44)
    let frameRequest = null;
    const scheduleFrame = () => { if (frameRequest === null && running && !lost) frameRequest = requestAnimationFrame(frame); };
    function frame(t) {
      frameRequest = null;
      if (!running) return;
      // (round 10a: the script of each animation frame, for diskFrameStats' js: its draw, from a frame's start to its finish, spans
      // the animation frames of a frame in bands (84 ms 'of script' a frame in a long check run: a still at scale 1 in bands))
      if (fstats) { const f0 = performance.now(); try { frameIn(t); } finally { if (fstats) fstats.js.push(performance.now() - f0); } return; }
      frameIn(t);
    }
    function frameIn(t) {
      // (diskBench draws on its own; so does diskSnapshot, round 9, its bands each waited for)
      // (round 9: and a script's frames, diskSettle and diskCost, each waited for: stepping)
      if (benching || snapping || stepping) { last = 0; lastRaw = 0; scheduleFrame(); return; }
      healthRead();   // (round 10a: see HEALTH_FS)
      // (round 10a: the oldest piece in flight not done after HUNG_MS while the animation frames run: told as hung, once)
      if (flight.length && !flight[0].hung && performance.now() - flight[0].t > HUNG_MS) {
        const f = flight[0]; f.hung = true;
        rec({ k: 'hung', id: f.rid || 0, key: f.key, ms: performance.now() - f.t, first: f.first ? 1 : 0, pre: f.pre ? 1 : 0, sc: f.scale, n: f.n, rows: f.rect || undefined });
      }
      // (round 9: the warm draw's pipelines being made, see warmFull: nothing more is sent until they are)
      if (warmSync && !warmDone()) { scheduleFrame(); return; }
      // (round 9: FULL warmed once linked whatever the page draws meanwhile, not at an idle moment that may not come)
      if (!fullWarm && !warmQueued && !lost && full !== false && lastDrawT) { warmQueued = true; warmLater(warmFull); }
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      if (fstats) { dirty = true; if (t >= fstats.until) fsDone(); }
      if (!paused) { time += dt * speed * clockK(); if (burst) burst.age += dt * speed; update(); dirty = true; }
      const moving = busy();
      if (moving) dirty = true;   // flights, fades and the sweep run in real time (see draw)
      // (round 9) a frame being drawn in bands goes on, one band at a time, each waited for (see bandsFor)
      // (round 10a: a frame in kicks, see SPLIT: its next piece once its band in hand is seen done or not; its last piece, the
      // band's picture and the finish, is light, and the next frame may be drawn in the same animation frame)
      let held = false;
      if (bandJob) {
        held = true;
        if (!gpuBehind(1) && !(duty > 0 && t < bandRestUntil) && splitReady(bandJob)) {
          const j = bandJob;
          if (!j.split && j.ad && j.st && lastBand.j === j) j.rows = rowsAfter(j.st, j, lastBand.ms, 0.5 * (gBudget > 0 ? gBudget : 120));
          bandStep(); fence(!bandJob, j);
          if (!bandJob && j.split) held = false;
        }
      }
      if (held) { /* (a frame in bands goes on) */ }
      else if (dirty || (accN && accN < ACC_MAX)) {
        if (gpuBehind()) { /* (the GPU is still on the frames before) */ }
        // (round 9) a frame that would only move the clock on waits for the frame rate's cap (see fpsCap)
        else if (fpsCap > 0 && !paused && !urgent && !moving && !viewMoving() && !fstats && lastDrawT && t - lastDrawT < 1000 / fpsCap - 3) { if (!capT0) capT0 = t; }
        // (round 10a: and the GPU's duty, see duty: the next frame not before the last one's work, over the duty, has passed)
        else if (duty > 0 && !urgent && !viewMoving() && !fstats && lastDrawT && t - lastDrawT < lastGpuFrame / duty - 3) { if (!capT0) capT0 = t; }
        // (round 10a, dev.5: FULL's warm, waiting for a moment with no frame in bands, taken here, between two frames: with the
        // frames of the view at rest in bands one after another (the ramp), its timer never found one, and FULL was not warm after
        // 10 s in a frame as WebKit on a GPU six times slower)
        else if (warmQueued && !fullWarm && !warmSync && !bandJob && full !== false && (warmFull(), !!warmSync)) { /* (the warm sent) */ }
        else {
          heldNow = capT0 ? t - capT0 : 0; capT0 = 0; urgent = false; lastDrawT = t;
          // (the statistics and the adaptive scale count the frames drawn)
          if (fstats) fstats.t.push(t); else adapt(t);
          draw(); dirty = false;
          fence(!bandJob, lastJob);
        }
      } else lastRaw = 0;   // (nothing to draw: the next drawn frame's interval starts afresh)
      scheduleFrame();
    }
    const start = () => { if (!reduce && !running && !lost) { running = true; last = 0; scheduleFrame(); } };
    // For measurements in a visible window (no animation frames come in a hidden one, nor with reduced motion):
    // diskFrameStats(seconds, { levelStep }) draws the model in every animation frame for that long (playing or
    // paused; the render scale held), and resolves with the intervals between frames (median, 95th percentile,
    // maximum; the share over 20 and over 33 ms), per frame the script of draw() and of the overlay within it (field
    // lines, envelope, slice, labels) and the overlay's style and layout forced right after it, and the overlay's size
    // (path elements, those with data, characters of path data). frames: 0 when none came. levelStep 4 draws the
    // field lines with every 4th of their 48 opacity levels (and the marks with every 2nd of their 24) for the time
    // of the measurement, so that about as many paths carry data as before the levels were made finer (12 + 12):
    // the same picture but for the banding, to compare the cost of the number of paths.
    const qs = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100; };
    function fsDone() {
      const f = fstats; if (!f) return;
      fstats = null; clearTimeout(f.timer);
      const iv = f.t.slice(1).map((v, i) => v - f.t[i]), paths = [...overlay.querySelectorAll('path')];
      const share = (lim) => (iv.length ? Math.round(iv.filter((v) => v > lim).length / iv.length * 1000) / 1000 : NaN);
      const st = (a) => ({ median: qs(a, 0.5), p95: qs(a, 0.95), max: qs(a, 1) });
      lvStep = 1;
      f.resolve({ frames: f.t.length, levelStep: f.levelStep, interval: { ...st(iv), over20: share(20), over33: share(33) }, draw: st(f.draw), js: st(f.js), overlay: st(f.over), layout: st(f.layout),
        paths: paths.length, pathsWithData: paths.filter((e) => e.getAttribute('d')).length, chars: paths.reduce((n, e) => n + (e.getAttribute('d') || '').length, 0),
        size: [rW, rH], scale: opt.scale, visible: document.visibilityState === 'visible' });
      dirty = true;
    }
    box.diskFrameStats = (seconds = 5, { levelStep = 1 } = {}) => new Promise((resolve) => {
      if (fstats) fsDone();
      lvStep = Math.max(1, Math.round(levelStep));
      fstats = { until: performance.now() + seconds * 1000, t: [], draw: [], over: [], layout: [], js: [], resolve, levelStep: lvStep };
      fstats.timer = setTimeout(fsDone, seconds * 1000 + 1000);   // (when no frames come)
      dirty = true;
    });
    // the gap's light tables (about 2 ms each), one per idle moment, so that a zoom or the tour never waits for one
    const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 3000 }) : (f) => setTimeout(f, 300);
    const prefetch = () => { if (gapLight(PLANET.A).prefetch()) idle(prefetch); else idle(makeEnv3); };
    idle(prefetch);
    // (round 9) FULL linked in the background after the first frame, and warmed when linked (see fullWarm)
    function warmFull() {
      warmQueued = false;
      if (fullWarm || lost || gl.isContextLost()) return;
      // (not between the bands of a frame, whose state it would leave, nor inside a measurement)
      if (bandJob || benching || probing || warmSync) { warmQueued = true; warmLater(warmFull); return; }
      // (without the extension the link blocks the page: said first, and done after the next frame has shown it; or a
      // moment later where no frame comes, a hidden page or a script drawing)
      if (!pcomp && full === null && !warmAnnounced) {
        warmAnnounced = true; warmQueued = true; box.dispatchEvent(new CustomEvent('diskwarm', { detail: { warming: 1, now: 1 } }));
        let go = false; const g = () => { if (!go) { go = true; warmFull(); } };
        requestAnimationFrame(() => setTimeout(g, 0)); setTimeout(g, 300); return;
      }
      const f = fullProgram();   // (without the extension: linked here)
      if (f === false) { fullWarm = true; return; }
      if (!f) { warmQueued = true; warmLater(warmFull); return; }   // (still being linked)
      // (the frames still in flight are seen done only after the pipelines are made: the GPU process answers no question about
      // a fence meanwhile, so their times say nothing; counted as first uses)
      for (const f of flight) f.first = true;
      if (!warmAnnounced) box.dispatchEvent(new CustomEvent('diskwarm', { detail: { warming: 1 } }));   // (the page may say it is preparing)
      warmRec = ++recId; rec({ k: 'warm', ph: 0, id: warmRec, key: kindNow() });   // (round 10a: see rec)
      warming = true;
      try { drawOnce(); } finally { warming = false; }
      // (round 9: and the envelope's streamers, a program linked and 80 layers drawn: made here, not in a frame, where
      // round 9's checks read a 535 ms piece while moving away)
      makeEnv3();
      warmSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); warmSent = performance.now();
      fullWarm = true; dirty = true;
      // (round 10a, dev.6: with reduced motion no animation frame looks at the warm: a timer does, and the picture is drawn again
      // once it is done, by FULL)
      if (reduce) { const poll = () => { if (lost) return; if (warmDone()) { if (W) drawOut(); return; } setTimeout(poll, 16); }; setTimeout(poll, 16); }
    }
    // the warm's pipelines made (its fence passed): said to the page, and its time reported as a first use
    let warmRec = 0;
    function warmDone() {
      if (!warmSync) return true;
      // (round 10a: a warm not done after HUNG_MS while the page runs, told once as hung; its end then as late)
      const age = performance.now() - warmSent;
      if (age > HUNG_MS && warmRec > 0) { rec({ k: 'hung', id: warmRec, w: 'warm', ms: age, first: 1 }); warmRec = -warmRec; }
      const tw = performance.now(), ws = gl.clientWaitSync(warmSync, 0, 0); slowSync('clientWaitSync warm', tw);
      if (ws === gl.TIMEOUT_EXPIRED) return false;
      gl.deleteSync(warmSync); warmSync = null; last = 0; gpuEnd = 0;
      rec({ k: 'warm', ph: 1, id: Math.abs(warmRec), ms: age, late: warmRec < 0 ? 1 : 0 }); warmRec = 0;
      piece('warm', performance.now() - warmSent, null, { first: 1 });
      box.dispatchEvent(new CustomEvent('diskwarm', { detail: { warming: 0 } }));
      return true;
    }
    // (round 9) FULL linked and warmed before a script's frames (diskSettle, diskCost, diskSnapshot), waited for (at most
    // maxMs); true when it is (or FULL failed to link and is not used)
    async function warmNow(maxMs = 10000) {
      const t0 = performance.now();
      while (!lost && performance.now() - t0 < maxMs) {
        if (fullWarm && warmDone()) return true;
        if (!fullWarm && !warmQueued && !bandJob) warmFull();
        await new Promise((r) => setTimeout(r, 16));
      }
      return fullWarm && !warmSync;
    }
    // (round 9) a piece of GPU work the animation frames do not report (diskgpu does those): a band or a frame of a script's
    // (diskSettle, diskCost, diskSnapshot), a measurement drawn whole on purpose (diskBench, diskRayProbe), the warm. Its
    // time to done in 'diskpiece', for a watch over long pieces (the checks' tripwire)
    function piece(what, ms, j, extra) {
      if (what === 'warm') { if (lastWarmGt) lastWarmGt.fence = ms; lastWarmGt = null; }
      else if (what !== 'bench') {
        const g = extra && extra.pre ? lastPreGt : lastBandGt;
        if (g && g.fence == null) { g.fence = ms; g.what = what; if (!gtPend.includes(g)) rec({ k: 'nofence', w: what, late: 1, ms: Math.round(ms) }); }   // (round 10a: see GT_NOFENCE)
        if (extra && extra.pre) lastPreGt = null; else lastBandGt = null;
      }
      if (j && j.rid) { rec({ k: 'piece', ph: 1, id: j.rid, ms }); j.rid = 0; lastRid = 0; }   // (round 10a: a script's band, see recBand)
      box.dispatchEvent(new CustomEvent('diskpiece', { detail: { what, ms: Math.round(ms * 10) / 10, key: j ? j.key : kindNow(), scale: opt.scale, first: j && j.first ? 1 : 0, rows: j && j.ad ? j.sent : rH, of: rH, ...extra } }));
    }
    // (round 9) a frame a script draws (diskSettle, diskCost): through the engine's guard and in its bands, as the animation
    // frames' (guardFrame, bandsFor), each band sent on its own and waited for; resolves with the frame's time
    async function scriptFrame(what, st) {
      const aim = 0.5 * (gBudget > 0 ? gBudget : 120);
      await gpuDone(); if (lost) return 0;   // (the frames before it done first: their work is theirs, measured by their fences)
      const t0 = performance.now(), vg = visGen;
      // (round 10a: a row's cost belongs to one size of the picture: a new scale starts over)
      if (st.rW !== rW || st.rH !== rH) { st.perRow = 0; st.rW = rW; st.rH = rH; }
      adaptRows = rowsAfter(st, null, 0, aim); adaptAim = aim;
      try { drawOnce(); } finally { adaptRows = 0; adaptAim = 0; }
      let j = await firstBand(what); if (lost) return performance.now() - t0;
      let b0 = j && j.sentAt >= t0 ? j.sentAt : t0, sum = 0, mx = 0;
      for (;;) {
        await gpuDone(); if (lost) break;
        const now = performance.now(), ms = now - b0; piece(what, ms, j); sum += ms; mx = Math.max(mx, ms);
        if (bandJob !== j) break;
        // (round 10a: a frame in kicks, see SPLIT: its band's time summed, its rows set when it is done (splitStep), the next
        // piece once the band is seen done or not)
        // (the query read at most once a frame: in WebKit each read is a round trip to the GPU's process, see slowSync)
        if (j.split) { j.bandMs = (j.bandMs || 0) + ms; j.lastMs = ms; j.st = st; j.aim = aim; while (!lost && bandJob === j && !splitReady(j)) await new Promise((r) => setTimeout(r, 16)); if (lost || bandJob !== j) break; }
        else j.rows = rowsAfter(st, j, ms, aim);
        bandStep(); b0 = performance.now();
      }
      // (what it cost, for the guard's next prediction, as the animation frames' are; a first use apart)
      if (j && !j.first && !j.cancelled && !lost && vg === visGen && !document.hidden) gNote(j.key.replace(/:F$/, ''), sum, opt.scale, j.n || 1, mx, /:F$/.test(j.key));
      return performance.now() - t0;
    }
    idle(() => { if (pcomp && !fullP && !lost) startFull(); if (!warmQueued) { warmQueued = true; warmLater(warmFull); } });
    const stop = () => {
      running = false;
      if (frameRequest !== null) { cancelAnimationFrame(frameRequest); frameRequest = null; }
    };
    const addClump = (R, phi, age) => {
      const c = clumps.reduce((a, b) => (a.amp <= 0 ? a : b.amp <= 0 ? b : a.t0 < b.t0 ? a : b));
      c.R = R; c.phi = phi; c.t0 = time - (age || 0); c.amp = 1; c.crossed = R - 0.05 * (age || 0) < rSn; c.gone = false;
    };
    const CLEAR = 4, CLEAR_S = 2.5;   // (round 9: see seedPlanet)

    // --- input: drag to rotate, wheel, pinch or keys to zoom, click to drop pebbles; touch as a map (see below) ---
    // closest approach: 2 au, or 0.25 au with the slice, where the structure of the inner disk (a few
    // hundredths of an au thick at 0.1 au) is to be seen
    const EL_MAX = 89 * Math.PI / 180;
    const DMAX = 600, dist0 = opt.dist, el0 = opt.el, az0 = opt.az, dmin = () => (follow ? 0.25 * (followed() ? followed().a : PLANET.A) / PLANET.A : MAG.DMIN);
    canvas.style.touchAction = 'none';   // (every touch on the picture is its own: see the touch handlers)
    canvas.tabIndex = 0;
    const clampEl = (v) => Math.min(EL_MAX, Math.max(-EL_MAX, v));   // (to 89 degrees: from straight above, the disk face-on)
    const touched = () => { dirty = true; urgent = true; if (reduce) drawOut(); };
    // tells the page that the view or the components changed from inside (keys, tour, easter eggs, a drag)
    const emitState = () => { if (box.diskState) box.dispatchEvent(new CustomEvent('diskstate', { detail: box.diskState() })); };
    const zoomBy = (f) => { const d = Math.min(DMAX, Math.max(dmin(), opt.dist * f)); if (d !== opt.dist && (coPending || coSavedKey || coHold)) coResume(); opt.dist = d; startFly(); touched(); };
    // the outburst (a click on the star, the B key): its clock is the model's, so a paused model starts again (the page's
    // button follows); none with reduced motion, where the clock does not run
    const burstNow = () => { if (reduce) return; if (paused) { paused = false; emitState(); } startBurst(); touched(); };
    // a planet grown from pebbles (the G key): the easter egg of three clumps, at 3 au if there is room for a planet
    // there, else at the first of 6, 12, 1.6 au that has room
    const growPlanet = () => {
      const R = [3, 6, 12, 1.6].find((r) => plRoom(r) && (planets.length < PLANETS.MAX || planets.some((p) => !plWant(p))));
      if (!R) return;
      seeds = [];
      const ph = PLANETS.PHI0(planets.length) + Omega(R) * time;
      for (let i = 0; i < 3; i++) { addClump(R + 0.08 * R * (i - 1), ph + 0.6 * (i - 1), 0); seedPlanet(R); }
      touched();
    };
    // a ring that spreads and fades where a clump was dropped (none with reduced motion)
    const ripple = (x, y) => {
      if (reduce || !overlay.animate) return;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [k, v] of [['cx', x], ['cy', y], ['r', 5], ['fill', 'none'], ['stroke', 'rgba(225,238,255,0.95)'], ['stroke-width', 1.5], ['vector-effect', 'non-scaling-stroke']]) c.setAttribute(k, v);
      c.style.transformOrigin = x + 'px ' + y + 'px'; c.style.transformBox = 'view-box';
      overlay.appendChild(c);
      c.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(4.5)', opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
      setTimeout(() => c.remove(), 950);
    };
    // a click (or a tap): on the star, an outburst; elsewhere pebbles dropped where the ray meets the midplane
    // (Disk Lab v2) a click on a shown planet sends 'diskplanet' (its index, and where it is on the canvas, CSS px) and
    // drops nothing; with data-pick="planet" a click on the disk sends 'diskpick' (the radius and azimuth where the ray
    // meets the midplane, and the canvas point) instead of dropping pebbles
    // (round 8, the owner: "don't drop pebbles on a tap by default; make it a mode of the pebbles' options": pebbles are
    // dropped only with data-pick="pebbles", the page's "Tap to drop pebbles"; one data-pick, so placing a planet and
    // dropping pebbles exclude each other. Three clumps near one radius still grow a planet (seedPlanet), in that mode;
    // the G key grows one as before)
    function clickAt(cx, cy) {
      const rect = canvas.getBoundingClientRect();
      const so = project([0, 0, 0]);
      // (round 7: within the point of light's reach, or on the planet's own disk where it shows larger, 0.4 R_H; not where
      // the cut takes it away or the star hides it)
      for (let i = 0; i < planets.length; i++) {
        const p = planets[i];
        if (p.amp < 0.5) continue;
        const P = planetPosOf(p, time), q = project(P);
        if (q[2] <= zN || !kept(P) || behindStar(P)) continue;
        const rc = 0.4 * hillOf(p) / q[2] * Hh / (2 * basis.th);
        if (Math.hypot(cx - rect.left - q[0], cy - rect.top - q[1]) < Math.max(12, 1.1 * rc)) { box.dispatchEvent(new CustomEvent('diskplanet', { detail: { i, a: p.a, x: q[0], y: q[1] } })); return; }
      }
      if (so[2] > zN && Math.hypot(cx - rect.left - so[0], cy - rect.top - so[1]) < 14 && box.dataset.pick !== 'planet') { burstNow(); return; }
      const nx = ((cx - rect.left) / rect.width) * 2 - 1, ny = 1 - ((cy - rect.top) / rect.height) * 2;
      const th = Math.tan(opt.fov / 2), asp = W / Hh;
      const rd = [0, 1, 2].map((i) => basis.f[i] + th * (nx * asp * basis.r[i] + ny * basis.u[i]));
      const t = -cam[2] / rd[2]; if (t <= 0) return;
      const x = cam[0] + rd[0] * t, y = cam[1] + rd[1] * t, R = Math.hypot(x, y);
      // (round 7: placing a planet reaches the gas disk's inner edge, PLANETS.RANGE; pebbles are dropped from 0.15 au)
      if (R < (box.dataset.pick === 'planet' ? 0.9 * PLANETS.RANGE[0] : 0.15) || R > 31 || !kept([x, y, 0]) || faceAlpha([x, y, 0]) > 0.5) return;
      if (box.dataset.pick === 'planet') { box.dispatchEvent(new CustomEvent('diskpick', { detail: { R, phi: Math.atan2(y, x), x: cx - rect.left, y: cy - rect.top } })); return; }
      if (box.dataset.pick !== 'pebbles') return;
      addClump(R, Math.atan2(y, x), 0);
      ripple(cx - rect.left, cy - rect.top);
      seedPlanet(R);
      touched();
    }
    // The mouse and the pen: a drag turns (with Shift, or the middle or the right button, it moves the point looked at);
    // a click is clickAt.
    let panning = false, mousePtr = null, mouseTravel = 0;
    // (the right button pans: no menu over the picture)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), on);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || mousePtr !== null) return;
      mousePtr = e.pointerId;
      // (only a real pointer can be captured; events made by a script have none)
      if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
      takeOver(); pauseTour();
      dragging = true; moved = false; mouseTravel = 0; px = e.clientX; py = e.clientY; panning = e.shiftKey || e.button === 1 || e.button === 2; if (e.button === 1) e.preventDefault();
    }, on);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== mousePtr || !dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      if ((dx || dy) && (coPending || coSavedKey || coHold)) coResume();
      // Small moves add up: a slow drag (including a path that comes back) must never become a click on release.
      mouseTravel += Math.abs(dx) + Math.abs(dy); if (mouseTravel > 3) moved = true;
      if (panning) panBy(dx, dy);
      else { azUser -= dx * 0.006; elUser = clampEl(elUser + dy * 0.006); }
      px = e.clientX; py = e.clientY;
      touched();
    }, on);
    const endMouse = () => { mousePtr = null; dragging = false; panning = false; };
    canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === mousePtr) { const wasDrag = moved; endMouse(); moved = true; if (wasDrag) emitState(); } }, on);
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId !== mousePtr) return;
      const wasDrag = moved, wasPan = panning; endMouse();
      if (wasDrag) emitState();
      if (wasDrag || wasPan || e.button > 0) return;   // (a click of the middle or right button, or with Shift, does nothing)
      clickAt(e.clientX, e.clientY);
    }, on);
    // Touch, as a map on a phone: one finger moves the point looked at (what is under it follows it); two fingers pinch
    // to zoom, twist to turn (the azimuth: what is under them turns with them) and, moved up or down together, tilt (the
    // elevation: up for a lower view); a double tap zooms in toward the tapped point (it stays under the finger), a tap
    // with two fingers zooms out; a single tap is a click (clickAt) once no second tap has followed. The picture takes
    // every touch (touch-action: none): the page scrolls from outside the panel. The first touch shows a short hint.
    // (Round 8, the owner: "on a phone, two fingers sometimes move the view sideways". Reproduced with synthetic touches
    // (ver2/tools/disk-lab-v2/touch-check.js, in frame.html at 390 px): two fingers moved the point looked at in three
    // ways, now gone. Two fingers never pan: their middle's drift moved the view (80 px for two fingers dragged 80 px
    // sideways, 30 px for a pinch opened unevenly); a pinch now zooms toward the point under the fingers' first middle,
    // which stays there, and nothing follows the middle. A second finger that comes within LATE_MS of the first undoes the
    // first one's pan (the start of a pinch, not a move; 24 px before). A finger left after two pans only once it has moved
    // LIFT_PX from where it was when the other lifted (the drift of a lifting finger, 14 px, moved the view).)
    const TAP_MS = 300, TAP_PX = 10, DTAP_PX = 32, LATE_MS = 250, LIFT_PX = 24;
    const tch = { pts: new Map(), last: null, t1: 0, t2: 0, moved: false, two: false, mode: '', g0: null, anc: null, pan0: null, lift: null, tapT: 0, tapX: 0, tapY: 0, tapTimer: 0, hinted: false };
    // the first two fingers: their spread, angle and middle
    const twoOf = () => { const [a, b] = [...tch.pts.values()]; return { a, b, s: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: 0.5 * (a.x + b.x), my: 0.5 * (a.y + b.y) }; };
    // zoom by f toward the point under (cx, cy): the point looked at moves toward it, so that it stays under the finger
    const zoomAt = (cx, cy, f) => {
      const rect = canvas.getBoundingClientRect(), ox = cx - rect.left - W / 2, oy = cy - rect.top - Hh / 2;
      const g = Math.min(DMAX, Math.max(dmin(), opt.dist * f)) / opt.dist;
      if (g !== 1 && (coPending || coSavedKey || coHold)) coResume();
      panBy(-ox * (1 - g), -oy * (1 - g)); opt.dist *= g;
      startFly(); touched(); emitState();
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      tch.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }); touching = true;
      if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
      takeOver(); pauseTour();
      if (!tch.hinted) { tch.hinted = true; touchHint(); }
      // (taps are timed by the events' own times: a long frame does not stretch them)
      if (tch.pts.size === 1) { tch.t1 = e.timeStamp; tch.moved = false; tch.two = false; tch.lift = null; tch.last = { x: e.clientX, y: e.clientY }; tch.pan0 = panV.slice(); }
      else if (tch.pts.size === 2) {
        // (a second finger soon after the first: the first one's pan is undone, it began the pinch)
        if (!tch.two && e.timeStamp - tch.t1 < LATE_MS && tch.pan0) { panV = tch.pan0.slice(); touched(); }
        // (the gesture is told from where both fingers are now)
        tch.two = true; tch.t2 = e.timeStamp; tch.mode = ''; tch.g0 = null; tch.lift = null;
        for (const q of tch.pts.values()) { q.x0 = q.x; q.y0 = q.y; }
      }
    }, on);
    canvas.addEventListener('pointermove', (e) => {
      const p = e.pointerType === 'touch' ? tch.pts.get(e.pointerId) : null; if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (tch.pts.size === 1) {
        // (a finger left after two: still until it has moved LIFT_PX from where it was)
        if (tch.lift) { if (Math.hypot(p.x - tch.lift.x, p.y - tch.lift.y) < LIFT_PX) { tch.last = { x: p.x, y: p.y }; return; } tch.lift = null; }
        if (!tch.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_PX) tch.moved = true;
        if (tch.moved) { if (coPending || coSavedKey || coHold) coResume(); panBy(p.x - tch.last.x, p.y - tch.last.y); tch.last = { x: p.x, y: p.y }; touched(); }
        return;
      }
      const g = twoOf();
      if (!tch.g0) {
        // told once both fingers have moved half of TAP_PX, or one of them twice TAP_PX (their moves come one finger at a
        // time): both up or down together, with little pinch or twist, tilts; anything else pinches, twists and moves
        const da = [g.a.x - g.a.x0, g.a.y - g.a.y0], db = [g.b.x - g.b.x0, g.b.y - g.b.y0], ma = Math.hypot(da[0], da[1]), mb = Math.hypot(db[0], db[1]);
        if (!(Math.min(ma, mb) >= 0.5 * TAP_PX || Math.max(ma, mb) >= 2 * TAP_PX)) return;
        const s0 = Math.hypot(g.b.x0 - g.a.x0, g.b.y0 - g.a.y0), ang0 = Math.atan2(g.b.y0 - g.a.y0, g.b.x0 - g.a.x0), dy = 0.5 * (da[1] + db[1]);
        const turn = Math.abs(wrapPi(g.ang - ang0)) * 0.5 * g.s;
        const together = da[1] * db[1] > 0 && Math.abs(da[1]) > 1.5 * Math.abs(da[0]) && Math.abs(db[1]) > 1.5 * Math.abs(db[0]);
        tch.mode = together && Math.abs(g.s - s0) < 0.5 * Math.abs(dy) && turn < 0.5 * Math.abs(dy) ? 'tilt' : 'pinch';
        tch.moved = true;
        // (from where the fingers came down: nothing of the gesture is lost to its telling)
        tch.g0 = { s: s0, ang: ang0, my: 0.5 * (g.a.y0 + g.b.y0), d: opt.dist, az: azUser, el: elUser };
        // (the zoom's anchor: the fingers' first middle, from the picture's centre)
        const rect = canvas.getBoundingClientRect();
        tch.anc = [0.5 * (g.a.x0 + g.b.x0) - rect.left - W / 2, 0.5 * (g.a.y0 + g.b.y0) - rect.top - Hh / 2];
      }
      if (coPending || coSavedKey || coHold) coResume();
      if (tch.mode === 'tilt') elUser = clampEl(tch.g0.el + (g.my - tch.g0.my) * 0.006);
      else {
        // (the zoom toward the anchor, as zoomAt: the point under it stays under it; no pan with the fingers' middle)
        const d1 = Math.min(DMAX, Math.max(dmin(), tch.g0.d * tch.g0.s / Math.max(g.s, 1))), f = d1 / opt.dist;
        if (f !== 1) panBy(-tch.anc[0] * (1 - f), -tch.anc[1] * (1 - f));
        opt.dist = d1;
        // (seen from below, the disk turns the other way on the screen)
        azUser = tch.g0.az + wrapPi(g.ang - tch.g0.ang) * (tch.g0.el < 0 ? -1 : 1);
      }
      touched();
    }, on);
    const touchEnd = (e, cancel) => {
      const p = e.pointerType === 'touch' ? tch.pts.get(e.pointerId) : null; if (!p) return;
      tch.pts.delete(e.pointerId); touching = tch.pts.size > 0;
      const now = e.timeStamp;
      if (tch.two) {
        // (a finger left after two: it goes on moving the point looked at, from where it is, once it has moved LIFT_PX)
        if (tch.pts.size === 1) { const [r] = [...tch.pts.values()]; tch.last = { x: r.x, y: r.y }; tch.lift = { x: r.x, y: r.y }; tch.mode = ''; tch.g0 = null; return; }
        if (tch.pts.size) return;
        const tap = !tch.moved && !cancel && now - tch.t2 < TAP_MS;
        tch.two = false; tch.mode = ''; tch.g0 = null;
        if (tap) zoomAt(canvas.getBoundingClientRect().left + W / 2, canvas.getBoundingClientRect().top + Hh / 2, 2);
        else emitState();
        return;
      }
      if (tch.pts.size) return;
      if (tch.moved || cancel) { if (tch.moved) emitState(); return; }
      if (now - tch.t1 > 400) return;   // (a long press does nothing)
      const x = e.clientX, y = e.clientY;
      if (tch.tapTimer && now - tch.tapT < TAP_MS && Math.hypot(x - tch.tapX, y - tch.tapY) < DTAP_PX) { clearTimeout(tch.tapTimer); tch.tapTimer = 0; zoomAt(x, y, 0.5); return; }
      tch.tapT = now; tch.tapX = x; tch.tapY = y;
      tch.tapTimer = setTimeout(() => { tch.tapTimer = 0; clickAt(x, y); }, TAP_MS);
    };
    canvas.addEventListener('pointerup', (e) => touchEnd(e, false), on);
    canvas.addEventListener('pointercancel', (e) => touchEnd(e, true), on);
    // The wheel zooms only when the panel has the focus (after a click on it, or Tab) or with Ctrl or Cmd held (a
    // trackpad's pinch comes as a wheel with ctrlKey): otherwise it scrolls the page, as a wheel over a picture should,
    // and a short hint fades in over the panel.
    const hint = document.createElement('div');
    hint.className = 'disk-hint'; hint.setAttribute('aria-hidden', 'true');
    hint.style.cssText = 'position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:calc(100% - 24px);padding:7px 13px;border-radius:6px;'
      + 'background:rgba(10,13,24,.84);color:#e6edf7;font:13px/1.5 var(--sans,sans-serif);text-align:center;pointer-events:none;opacity:0;transition:opacity .3s';
    box.appendChild(hint);
    let hintT = 0;
    const wheelHint = () => {
      hint.textContent = ja() ? 'クリックしてからホイールでズーム(⌘/Ctrl+ホイールでも。クリックで小石が置かれます。Tab でも可)' : 'Click the picture, then scroll to zoom (or \u2318/Ctrl + scroll; a click drops pebbles, Tab works too)';
      hint.style.opacity = '1'; clearTimeout(hintT); hintT = setTimeout(() => { hint.style.opacity = '0'; }, 1600);
    };
    // (the first touch: how to move, as on a map)
    const touchHint = () => {
      hint.textContent = ja() ? '指 1 本で移動、2 本でズーム' : 'One finger moves, two zoom';
      hint.style.opacity = '1'; clearTimeout(hintT); hintT = setTimeout(() => { hint.style.opacity = '0'; }, 2200);
    };
    canvas.addEventListener('wheel', (e) => {
      if (document.activeElement !== canvas && !e.ctrlKey && !e.metaKey) { wheelHint(); return; }
      e.preventDefault(); pauseTour(); zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); emitState();
    }, { passive: false, signal: ac.signal });
    // The keys: arrows turn (with Shift they move the point looked at, by a tenth of the picture), + and - zoom, Home goes
    // back to the first view and to the star, C brings the point looked at back to the star (the view kept), space
    // pauses; 1 to 5 the views' angles (VIEWS, in step with the preview page's buttons: the distance and the point looked
    // at stay), P the planet, F the field lines, S the slice, A the annotations.
    const VIEWS = [[el0 * 180 / Math.PI, az0 * 180 / Math.PI, dist0], [10, -80, 85], [2, -80, 85], [89, -65, 100], [-14, -80, 85]];
    const PLANET_VIEW = { p: 1, el: 30, az: 160, d: 1.6, tx: 0, ty: 0, tz: 0 };
    // (only a handled model key pauses automatic tour advancement; moving focus leaves it alone)
    canvas.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key; let used = true;
      const view = (st) => { if (opt.slice) box.diskSlice(false); box.diskSet({ ...st, fly: 1 }); };
      if (k.startsWith('Arrow') && (coPending || coSavedKey || coHold)) coResume();
      if (e.shiftKey && k.startsWith('Arrow')) { const a = 0.1 * Hh; panBy(k === 'ArrowLeft' ? -a : k === 'ArrowRight' ? a : 0, k === 'ArrowUp' ? -a : k === 'ArrowDown' ? a : 0); startFly(); }
      else if (k === 'ArrowLeft') { azUser += 0.08; startFly(); } else if (k === 'ArrowRight') { azUser -= 0.08; startFly(); }
      else if (k === 'ArrowUp') { elUser = clampEl(elUser + 0.05); startFly(); } else if (k === 'ArrowDown') { elUser = clampEl(elUser - 0.05); startFly(); }
      else if (k === '+' || k === '=') zoomBy(0.8); else if (k === '-' || k === '_') zoomBy(1.25);
      else if (k === 'Home') box.diskHome();
      else if (k === 'c' || k === 'C') box.diskCenter();
      else if (k === ' ') box.diskPlay(paused);
      else if (k >= '1' && k <= '5') { const v = VIEWS[Number(k) - 1]; view({ p: 0, el: v[0], az: v[1] }); }
      else if (k === 'p' || k === 'P') view(PLANET_VIEW);
      else if (k === 'f' || k === 'F') box.diskField(!showField);
      else if ((k === 's' || k === 'S') && opt.look === 'model') { if (!opt.slice) box.diskSlice(true, null, 'half'); else if (opt.cut === 'half') box.diskSlice(true, null, 'quarter'); else box.diskSlice(false); }   // none, 1/2, 1/4 (not in the observed looks)
      else if (k === 'a' || k === 'A') box.diskAnnotations(!opt.ann);
      else if (k === 'b' || k === 'B') burstNow();
      else if (k === 'g' || k === 'G') growPlanet();
      else used = false;
      if (used) { e.preventDefault(); pauseTour(); touched(); emitState(); }
    }, on);
    // adaptive render scale: when frames fall behind, render smaller; when they are comfortably on time,
    // work back up toward data-scale-max (the lines in the overlay are vector and unaffected)
    let fEma = 16.7, fN = 0, raiseLock = 0, lastRaw = 0;
    function adapt(t) {
      const dtRaw = lastRaw ? t - lastRaw : 16.7; lastRaw = t;
      if (paused || box.dataset.adapt === 'off') return;   // (Disk Lab v2: the page sets the scale, quality.js)
      fEma += (dtRaw - fEma) * 0.1;
      if (++fN < 90) return;
      fN = 0;
      if (fEma > 24 && opt.scale > 0.4) { opt.scale = Math.max(0.4, opt.scale * 0.8); raiseLock = 20; rescale(); }
      else if (fEma < 17.5 && opt.scale < opt.scaleMax && raiseLock-- <= 0) { opt.scale = Math.min(opt.scaleMax, opt.scale * 1.15); rescale(); }
    }
    // resize writes the box's height. Do that in the next task, outside ResizeObserver's delivery, so a width change
    // does not resize the observed box again in that delivery (and produce an undelivered-notification error).
    let resizeTimer = 0;
    const watchers = [new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 0); }), new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? start() : stop()))),
      new MutationObserver(() => { if (toastMsg && toast.style.opacity === '1') toast.textContent = toastText(); if (tour) tourEvent(); drawOut(); })];
    watchers.push(new MutationObserver(resize));   // (data-aspect changed by the page: a phone turned, a window resized)
    watchers[0].observe(box); watchers[1].observe(box); watchers[3].observe(box, { attributes: true, attributeFilter: ['data-aspect'] });
    watchers[2].observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()), on);
    // A lost WebGL context (the GPU reset, or the browser took it back): drawing stops and the static picture shows
    // (the default view; the canvas and the overlay hide). When the context is restored, this build is taken down (its
    // listeners, watchers, timers and overlay) and the model is built anew on the same canvas, with the state it had
    // (the view, the components, the look, the time; not the clumps or an outburst). The page learns of both from
    // disklost events.
    const still = box.querySelector('.disk-static');
    const stillShown = (v) => { canvas.style.visibility = v ? 'hidden' : ''; overlay.style.visibility = v ? 'hidden' : ''; toast.style.visibility = v ? 'hidden' : ''; if (still) still.style.display = v ? 'block' : ''; };
    // (round 10a: with the browser's message, if any, and what was in flight then, for the recorder)
    const lostEvent = (v, more = {}) => box.dispatchEvent(new CustomEvent('disklost', { detail: { lost: v, ...more } }));
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();   // (so that the browser restores it)
      const inFlight = flight.map((f) => (f.pre ? 'pre:' : '') + f.key + '@' + f.scale + (f.n > 1 ? '/' + f.n : '') + (f.rect ? ' rows ' + f.rect[0] + '-' + f.rect[1] + ' of ' + f.rect[3] + ' x' + f.rect[2] : '') + ' ' + Math.round(performance.now() - f.t) + 'ms');
      lost = true; stop(); stopTour(true); hush(); stillShown(true); lostEvent(true, { msg: String(e.statusMessage || ''), key: kindNow(), sc: opt.scale, inFlight, warming: warmSync ? 1 : 0 });
      if (bandJob) { bandJob.cancelled = true; bandJob = null; }   // (round 10a: see cancelJob)
    }, on);
    canvas.addEventListener('webglcontextrestored', () => {
      // (the clock directly: diskSet would hold it within its limit for input from outside; from dc55d44)
      const { time: restoredTime, ...st } = box.diskState();
      ac.abort(); watchers.forEach((w) => w.disconnect()); clearTimeout(resizeTimer); stopTour(true); hush(); clearTimeout(toastTimer);
      overlay.remove(); toast.remove(); hint.remove(); descEl.remove(); keysEl.remove(); clearTimeout(hintT); stillShown(false);
      try {
        init(box, canvas, restoredTime);
        box.diskSet({ ...st, fly: 0 });
        box.dispatchEvent(new CustomEvent('diskstate', { detail: box.diskState() }));
      } catch (err) {
        box.querySelectorAll(':scope > canvas, :scope > .disk-overlay').forEach((el) => el.remove());
        box.dataset.fallbackError = String((err && err.message) || err).slice(0, 240); box.classList.add('disk-fallback'); console.error(err);
      }
      lostEvent(false);
    }, on);
    resize();
    const finiteNumber = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN;
    // Use the state's time validation and CO ownership rules; this entry point also draws immediately.
    box.diskSetTime = (t) => { const st = checked({ time: t }); if (st.time != null) { box.diskSet(st); if (!reduce) drawOut(); } };
    box.diskBurst = () => { startBurst(); touched(); };
    // a clump of pebbles dropped as a click drops one (three near the planet's orbit grow it, see seedPlanet)
    // The click's disk domain (0.15..31 au), radians, and the clump's 120 s lifetime; invalid calls leave it alone.
    box.diskAddClump = (R, phi, age = 0) => {
      const r = finiteNumber(R), ph = finiteNumber(phi), a = finiteNumber(age);
      if (!isFinite(r) || r < 0.15 || r > 31 || !isFinite(ph) || !isFinite(a) || a < 0 || a > 120) return;
      addClump(r, wrapPi(ph % (2 * Math.PI)), a); if (!a) seedPlanet(r); drawOut();
    };
    // controls for the preview page: view (degrees, au), components, time, state for links, snapshots
    // (to 0.01 degree and 0.001 au, so that a link restores the picture to within a pixel)
    const deg = (r) => Math.round(r * 18000 / Math.PI) / 100;
    // az is measured from the planet's azimuth while following it (p = 1)
    box.diskState = () => ({ el: deg(elUser), az: deg(azUser + (follow || reduce ? 0 : opt.spin * time)), d: Math.round(opt.dist * 1000) / 1000, mode: opt.mode, field: showField ? 1 : 0, speed, paused: paused ? 1 : 0, time, slice: opt.slice ? (opt.cut === 'quarter' ? 2 : 1) : 0, sq: opt.sliceQ, p: follow ? 1 : 0, pi: followI, gain: opt.gain.slice(), planets: planets.map((pl) => [pl.a, pl.on ? 1 : 0, pl.m]), ann: opt.ann ? 1 : 0, look: opt.look, ms: opt.ms ? 1 : 0, asym: opt.asym ? 1 : 0, marks: opt.marks ? 1 : 0, waves: opt.waves ? 1 : 0, bg: opt.bg, fx: opt.fx, coMode: opt.coMode, coV: opt.coV, coRange: Math.exp(coLn), coRangeFixed: coHold ? 1 : 0,
      tx: Math.round(panV[0] * 1e4) / 1e4, ty: Math.round(panV[1] * 1e4) / 1e4, tz: Math.round(panV[2] * 1e4) / 1e4 });
    box.diskLegend = () => legendSpec();
    // (round 8) the materials' colours of the model's look (see MAT), for the page's key: key, colour (sRGB), names; with
    // { key: '#rrggbb' } or { key: ['#rrggbb', k] } a colour (and its brightness factor) is changed for this page (for trying
    // colours; nothing keeps it)
    box.diskPalette = (set) => {
      if (set && typeof set === 'object') for (const m of MAT) {
        const v = set[m[0]], hex = Array.isArray(v) ? v[0] : v, k = Array.isArray(v) ? Number(v[1]) : m[2];
        if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) && k > 0 && k < 10) { m[1] = hex; m[2] = k; matLin.set(linHex(hex).map((c) => c * k), 3 * MAT.indexOf(m)); dirty = true; }
      }
      return MAT.map(([key, hex, k, ja_, en]) => ({ key, hex, k, ja: ja_, en }));
    };
    // A state from outside (a link, the page, a script) is checked first: the numbers must be finite (a link copied with
    // text after it, or edited by hand, must not poison the picture: a NaN in the camera or the clock would blank it),
    // the distance and the speed positive, the components a mask of the six, the time within [0, TIME_MAX] (the shader's
    // clock is single precision); what fails is left as it is.
    const NUM_KEYS = ['slice', 'p', 'pi', 'time', 'el', 'az', 'd', 'tx', 'ty', 'tz', 'mode', 'field', 'ann', 'ms', 'asym', 'marks', 'waves', 'coV', 'coRange', 'coRangeFixed', 'speed', 'paused', 'fly'];
    const checked = (raw) => {
      const st = { ...raw };
      for (const k of NUM_KEYS) {
        if (!(k in st)) continue;
        const n = finiteNumber(st[k]);
        if (isFinite(n)) st[k] = n; else delete st[k];
      }
      if (st.d != null && !(st.d > 0)) delete st.d;
      if (st.speed != null && !(st.speed > 0)) delete st.speed;
      if (st.speed != null) st.speed = Math.min(10, Math.max(0.1, st.speed));
      if (st.time != null) st.time = Math.min(TIME_MAX, Math.max(0, st.time));
      if (st.mode != null) st.mode = Math.round(st.mode) & 127;   // (round 8: 64, the jet)
      if (st.slice != null) st.slice = Math.min(2, Math.max(0, Math.round(st.slice)));
      // Wrap degrees before converting to radians: even a finite 1e308 would overflow when multiplied by pi.
      if (st.az != null) st.az = ((st.az % 360) + 540) % 360 - 180;
      // The CO range search uses factors 1..30; a fixed flag is exactly 0 or 1, not an arbitrary truthy number.
      if (st.coRange != null && (st.coRange < 1 || st.coRange > Math.exp(Math.log(30)))) delete st.coRange;
      if (st.coRange != null) st.coRange = Math.min(30, st.coRange);   // exp(log(30)) may exceed 30 by one rounding unit
      if (st.coRangeFixed != null && st.coRangeFixed !== 0 && st.coRangeFixed !== 1) delete st.coRangeFixed;
      for (const k of ['tx', 'ty', 'tz']) if (st[k] != null) st[k] = Math.min(PAN_MAX, Math.max(-PAN_MAX, st[k]));
      return st;
    };
    box.diskSet = (raw) => {
      const st = checked(raw || {});
      const coBefore = [elUser, wrapPi(azUser + viewOff()), opt.dist, follow, ...panV, opt.look, opt.coMode, opt.coV];
      const mode0 = opt.mode, slice0 = opt.slice, asym0 = opt.asym, waves0 = opt.waves;
      // the slice and following the planet first (they exclude each other), since they set how close the camera may come
      // slice: 0 closed, 1 the 1/2 cut, 2 the 1/4 cut
      if (st.slice != null) { const k = Number(st.slice); opt.slice = k > 0; if (k > 0) opt.cut = k === 2 ? 'quarter' : 'half'; if (opt.slice) follow = false; }
      // (Disk Lab v2) the planets: [[a, on], ...] (see planetsFrom); a planet keeps its fade where its place keeps its a
      if (st.drag != null) plDrag = !!Number(st.drag);   // (round 9: a planet's slider being dragged, see PL_FULL_MS)
      if (Array.isArray(st.planets)) {
        const list = planetsFrom(st.planets);
        list.forEach(([a, on, m], i) => {
          const pl = planets[i];
          if (pl) { if (pl.a !== a || pl.m !== m) { pl.a = a; pl.m = m; pl.q = qOfM(m); pl.dSet = -1; pl.trap = trapOf(0, a, [], pl.q); } pl.on = on; }
          else planets.push(Object.assign(planetObj(a, on, i, m), { amp: 0 }));
        });
        planets.length = list.length;
        if (followI >= planets.length) followI = 0;
      }
      if (Array.isArray(st.gain) && st.gain.length === 4 && st.gain.every((g) => isFinite(Number(g)))) opt.gain = st.gain.map((g) => Math.min(3, Math.max(0.25, Number(g))));
      if (st.pi != null) followI = Math.max(0, Math.min(PLANETS.MAX - 1, Math.round(st.pi)));
      if (st.p != null) { follow = !!Number(st.p) && planets.length > 0; if (follow) opt.slice = false; }
      if (st.sq != null && sqOf(st.sq)) opt.sliceQ = sqOf(st.sq);
      opt.dist = Math.max(opt.dist, dmin());
      // the time before the view: az is the azimuth at that time (the slow spin is taken off it)
      if (st.time != null) { time = Number(st.time); update(); }
      if (st.el != null) elUser = clampEl(st.el * Math.PI / 180);
      if (st.az != null) azUser = st.az * Math.PI / 180 - (follow || reduce ? 0 : opt.spin * time);
      if (st.d) opt.dist = Math.min(DMAX, Math.max(dmin(), st.d));
      if (st.tx != null || st.ty != null || st.tz != null) panV = clampPan([st.tx ?? panV[0], st.ty ?? panV[1], st.tz ?? panV[2]]);
      if (st.mode != null) opt.mode = Number(st.mode);
      if (st.field != null) showField = !!Number(st.field);
      if (st.ann != null) opt.ann = !!Number(st.ann);
      if (st.ms != null) opt.ms = !!Number(st.ms);
      if (st.asym != null) opt.asym = !!Number(st.asym);
      if (st.marks != null) opt.marks = !!Number(st.marks);
      if (st.waves != null) opt.waves = !!Number(st.waves);
      if (st.bg != null && own(BG.MODES, st.bg)) opt.bg = st.bg;   // (round 8: the background, see BG)
      if (st.fx != null && isFinite(Number(st.fx))) opt.fx = Math.max(0, Math.min(2, Math.round(Number(st.fx))));   // (round 8: see opt.fx)
      if (st.coMode != null && own(CO_MODES, st.coMode)) opt.coMode = st.coMode;
      if (st.coV != null && isFinite(Number(st.coV))) opt.coV = Math.max(-20, Math.min(20, Math.round(Number(st.coV) * 100) / 100));
      // the look: the slice belongs to the model's look (opening it returns there; an observed look closes it)
      if (st.look != null && own(LOOKS, st.look) && st.look !== opt.look) {
        opt.look = st.look; lookT0 = performance.now();
        if (opt.look !== 'model' && opt.slice && st.slice == null) box.diskSlice(false);
      }
      if (opt.slice && opt.look !== 'model') { opt.look = 'model'; lookT0 = performance.now(); }
      if (st.speed) speed = Number(st.speed);
      if (st.paused != null) paused = !!Number(st.paused);
      // a new view: with fly the camera flies there from where it is, otherwise it is there at once
      if (st.el != null || st.az != null || st.d != null || st.p != null || st.slice != null || st.tx != null || st.ty != null || st.tz != null) { if (Number(st.fly)) startFly(); else flyV = flyT = null; }
      const coAfter = [elUser, wrapPi(azUser + viewOff()), opt.dist, follow, ...panV, opt.look, opt.coMode, opt.coV];
      // (round 9) a jump: see probeNext
      // (the view's own jump: a turn of more than 5 degrees, a tenth of the distance, following a planet or not; not the small
      // steps of a camera that follows a planet whose orbit a slider moves, every input a jump, every frame then in bands:
      // round 9, the slider's latency at the planet 108 ms against 71 before)
      const dA = (i) => Math.abs(wrapPi(coAfter[i] - coBefore[i]));
      const viewJump = !Number(st.fly) && !Array.isArray(st.planets) && (dA(0) > 0.09 || dA(1) > 0.09 || Math.abs(coAfter[2] - coBefore[2]) > 0.1 * coBefore[2]
        || coAfter[3] !== coBefore[3] || Math.hypot(coAfter[4] - coBefore[4], coAfter[5] - coBefore[5], coAfter[6] - coBefore[6]) > 0.1 * coBefore[2]);
      const jump = viewJump || coAfter[7] !== coBefore[7] || coAfter[8] !== coBefore[8]
        || [mode0, slice0, asym0, waves0].some((v, i) => v !== [opt.mode, opt.slice, opt.asym, opt.waves][i]);
      if (jump && !reduce) { probeNext = PROBE_FRAMES; for (const k in gKnown) delete gKnown[k]; kickResetAll(); }
      if (jump) cancelJob();   // (round 10a: see cancelJob)
      // A later visitor command redirects the view, so an unfinished restore no longer owns its range. The target
      // stays unchanged while its own flight/fades run (or the canvas resizes), which must retain the pending range.
      if (st.coRange == null && coAfter.some((v, i) => v !== coBefore[i])) {
        coResume();
      }
      if (st.coRange != null || st.coRangeFixed === 1) {
        coPending = { ln: st.coRange != null ? Math.log(st.coRange) : coLn, fixed: st.coRangeFixed != null ? !!st.coRangeFixed : coHold };
        coSavedKey = ''; coGen++; coFresh = true;
      } else if (st.coRangeFixed === 0) {
        coResume();
      }
      touched();
    };
    box.diskView = (elevationDeg, azimuthDeg, distance) => box.diskSet({ el: elevationDeg, az: azimuthDeg, d: distance, p: 0 });
    box.diskPlanetView = () => box.diskSet({ ...PLANET_VIEW, fly: 1 });
    // (Disk Lab v2) the planets as they are now: radius, on, shown (its fade), and where each is on the canvas (CSS px;
    // null behind the camera)
    // (round 8, for the owner's choice of the gaps' viscosity, not used by the page) the gaps drawn with another alpha; no
    // argument reads it
    box.diskGapAlpha = (a) => {
      if (a == null) return GAP_ALPHA;
      const v = finiteNumber(a);
      if (isFinite(v) && v >= 1e-5 && v <= 0.1) { GAP_ALPHA = v; gapKMemo.clear(); trapMemo.clear(); gapLightMemo.clear(); planets.forEach((p) => { p.dSet = -1; }); plRows = ''; dirty = true; }
      return GAP_ALPHA;
    };
    // (round 8) the smallest ratio of radii between neighbouring planets of masses m1 and m2 (M_J), see MASS
    box.diskMinRatio = (m1 = 1, m2 = 1) => minRatio(Number(m1) || 1, Number(m2) || 1);
    box.diskPlanets = () => planets.map((p) => { const q = project(planetPosOf(p, time)); return { a: p.a, on: p.on, shown: p.amp, x: q[2] > zN ? q[0] : null, y: q[2] > zN ? q[1] : null }; });
    // back to the centre: the point looked at back to the star (the planet, when following it), the view as it is
    box.diskCenter = () => { box.diskSet({ tx: 0, ty: 0, tz: 0, fly: 1 }); emitState(); };
    // the first view and the star (the Home key, the page's button): the slice closed, the point looked at the star
    box.diskHome = () => { box.diskSet({ p: 0, slice: 0, el: el0 * 180 / Math.PI, az: az0 * 180 / Math.PI, d: dist0, tx: 0, ty: 0, tz: 0, fly: 1 }); emitState(); };
    // --- the tour: chapters may be selected by the visitor, or advanced automatically by the legacy diskTour(true).
    // Each chapter establishes the view/components its existing text describes, even when entered directly from an
    // observed look or with components disabled. Direct model input pauses advancement, keeping the chapter and its
    // temporary options for inspection; those options return only on a chapter change or explicit exit. ---
    const home = () => box.diskSet({ p: 0, slice: 0, el: VIEWS[0][0], az: VIEWS[0][1], d: VIEWS[0][2], tx: 0, ty: 0, tz: 0, fly: 1 });
    const TOUR = [
      { go: () => home(), ms: 8000, title: ['円盤の全体像', 'The whole disk'],
        ja: '原始惑星系円盤のモデル(半径 30 au)。星の光が反り返った表層を温め、赤道面は冷たいままです。表面からは、磁場に駆動された風が吹き出しています。',
        en: 'A model of a protoplanetary disk, 30 au in radius. Starlight warms its flared surface while the midplane stays cold. A magnetically driven wind leaves the surface.' },
      { go: () => box.diskSet({ p: 0, slice: 0, el: 30, az: -65, d: 9, tx: 0, ty: 0, tz: 0, fly: 1 }), ms: 9000, tmp: { waves: 1 }, title: ['スノーラインと惑星', 'Snow line and planet'],
        ja: '内側の数 au に寄りました。約 1 au のスノーラインの外では、赤道面に沈んだ小石が氷をまとっています。3 au の惑星がギャップを開け、渦巻きの波を立てています(この段では波を強調表示しています)。',
        en: 'Closer in, the inner few au: beyond the snow line near 1 au the pebbles settled at the midplane are icy, and a planet at 3 au opens a gap and raises spiral waves (shown exaggerated in this step).' },
      { go: () => box.diskSet({ p: 0, slice: 0, el: 22, az: -65, d: 0.15, tx: 0, ty: 0, tz: 0, fly: 1 }), ms: 11000, title: ['星への降着', 'Accretion onto the star'],
        ja: '星のすぐ近く(0.15 au)。星の双極子磁場が円盤を 0.05 au で切り取り(内側は円盤のない磁気圏)、ガスは閉じた磁力線に沿って、2 枚の弧状のカーテンになって星へ落ちています(着地のときは秒速約 400 km)。着地点は弧状の熱いスポットになり、星と一緒に回ります。0.05〜0.08 au はダストのないガスの円盤です。ここでは時計を遅くしています。',
        en: 'Right next to the star (0.15 au). Its dipole field truncates the disk at 0.05 au (inside, the magnetosphere holds no disk); the gas falls onto the star along the closed field lines as two arc-shaped curtains (about 400 km/s at impact), landing in arcs of hot spots that turn with the star. Between 0.05 and 0.08 au the gas disk has no dust. The clock runs slower here.' },
      { go: () => box.diskSet({ ...PLANET_VIEW, slice: 0, fly: 1 }), ms: 9500, title: ['惑星と周惑星円盤', 'Planet and its disk'],
        ja: '3 au の木星質量の惑星です。ガスを押しのけてギャップを開け、まわりに周惑星円盤を持っています。後ろに明るく見えるのは、星の光を受けたギャップの外側の壁です。',
        en: 'A Jupiter-mass planet at 3 au. It pushes the gas aside into a gap and has its own circumplanetary disk; behind it, the outer wall of the gap is lit by the star.' },
      { go: () => box.diskSet({ p: 0, slice: 1, sq: 'T', ...CUT_VIEW.half, az: -65, tx: 0, ty: 0, tz: 0, fly: 1 }), ms: 10000, tmp: { marks: 1 }, title: ['温度の断面', 'A slice through temperature'],
        ja: '星を通る断面です。色は温度で、星の光が届く表層(白い線 τ* = 1 より上)は熱く、内部は冷たいままです。水色の破線は氷の境界、矢印は円盤風の速さです(この段では流れの印を表示しています)。',
        en: 'A slice through the star, coloured by temperature: the layer reached by starlight (above the white line, tau* = 1) is hot and the interior cold. The dashed line is the ice boundary; the arrows show the wind (the flow marks are shown in this step).' },
      { go: () => box.diskSet({ p: 0, slice: 2, sq: 'layers', ...CUT_VIEW.quarter, az: -65, tx: 0, ty: 0, tz: 0, fly: 1 }), ms: 12000, title: ['磁場とガスの結合', 'Field and gas coupling'],
        ja: '右手前の 4 分の 1 を切り取り、右の切り口を正面から見ています(左半分は切らずに残した円盤)。切り口は磁場とガスの結合で塗り分けました。紺がデッドゾーン(磁場が結合せず、乱流もない)、青がその上の層流の表層、琥珀色が表層降着の層、内側の朱色が熱電離して乱れた領域です。降着の層は、磁場が回転と同じ向きのとき片側(ここでは下)にできます。',
        en: 'The near right quarter cut away, its right face seen face-on (the left half of the disk left whole), coloured by how the field couples to the gas: the dead zone in navy (no coupling, no turbulence), the laminar surface above it in blue, the accretion layer in amber, and the turbulent, thermally ionized inner disk in red. With the field aligned with the rotation the accretion layer forms on one side (here below).' },
      { go: () => box.diskSet({ p: 0, slice: 0, el: 14, az: -65, d: 340, tx: 0, ty: 0, tz: 0, fly: 1 }), ms: 10000, mode: 63, title: ['母体の雲から円盤へ', 'From cloud to disk'],
        ja: '遠くから見ると、母体の雲の名残(エンベロープ)が回転しながら円盤へ落ちてきます。軸に沿った空洞の壁が、星の光で明るく見えます。',
        en: 'From afar, the remains of the parent cloud (the envelope) fall onto the disk as they rotate; the walls of a cavity along the axis are lit by the star.' },
      { go: () => home(), ms: 6000, last: true, title: ['自由に調べる', 'Explore freely'],
        ja: 'ツアーはここまでです。ドラッグで回し、ボタンやキーで成分や断面を切り替えて、自由に見てください。',
        en: 'That is the tour. Drag to look around, and use the buttons or keys to switch components and the slice.' }
    ];
    let tour = null, tourTmp = null;
    const tourState = () => ({ on: !!tour, step: tour ? tour.i : -1, total: TOUR.length, autoplay: !!tour && tour.autoplay,
      title: tour ? TOUR[tour.i].title[ja() ? 0 : 1] : '', text: tour ? TOUR[tour.i][ja() ? 'ja' : 'en'] : '' });
    const tourEvent = () => box.dispatchEvent(new CustomEvent('disktour', { detail: tourState() }));
    // (a step's own options back as they were before it)
    const tourRestore = () => { if (tourTmp) { box.diskSet(tourTmp); tourTmp = null; emitState(); } };
    const tourSchedule = () => {
      if (!tour || !tour.autoplay) return;
      const active = tour, st = TOUR[active.i];
      active.timer = setTimeout(() => { if (tour === active) { if (st.last) stopTour(false); else tourStep(active.i + 1, true, active.toast); } }, st.ms);
    };
    function tourStep(i, autoplay = false, toastOn = false) {
      const sameChapter = tour && tour.i === i;
      if (tour) clearTimeout(tour.timer);
      if (!sameChapter) tourRestore();
      const st = TOUR[i];
      if (st.tmp && !sameChapter) { const s0 = box.diskState(); tourTmp = Object.fromEntries(Object.keys(st.tmp).map((k) => [k, s0[k]])); }
      tour = { i, timer: 0, autoplay: !!autoplay && !reduce, toast: toastOn };
      sliceBefore = null;
      box.diskSet({ look: 'model', field: 1, ann: 1, ms: 1, asym: 1, marks: 0, mode: st.mode ?? 31 });
      if (st.tmp) box.diskSet(st.tmp);
      st.go();
      box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: opt.mode } }));
      if (toastOn) say(st.ja, st.en, st.ms - 300); else hush();
      tourSchedule(); touched(); emitState(); tourEvent();
    }
    function stopTour(quiet) {
      if (!tour) return;
      clearTimeout(tour.timer); tour = null;
      tourRestore();
      if (!quiet) hush();
      tourEvent();
    }
    function pauseTour() {
      if (!tour || !tour.autoplay) return;
      clearTimeout(tour.timer); tour.timer = 0; tour.autoplay = false; hush(); tourEvent();
    }
    box.diskTourState = () => tourState();
    box.diskTourChapters = () => TOUR.map((st) => ({ title: st.title[ja() ? 0 : 1], text: st[ja() ? 'ja' : 'en'] }));
    box.diskTour = (arg) => {
      if (arg === false || arg == null) { stopTour(false); hush(); return tourState(); }
      if (lost) return tourState();
      if (arg === true) { stopTour(true); tourStep(0, true, true); return tourState(); }
      if (typeof arg !== 'object') return tourState();
      const hasStep = Object.prototype.hasOwnProperty.call(arg, 'step'), n = hasStep ? finiteNumber(arg.step) : NaN;
      if (hasStep && !isFinite(n)) return tourState();
      const i = hasStep ? Math.min(TOUR.length - 1, Math.max(0, Math.round(n))) : tour ? tour.i : 0;
      const autoplay = typeof arg.autoplay === 'boolean' ? arg.autoplay : hasStep ? false : !!tour && tour.autoplay;
      if (!tour || hasStep || i !== tour.i) tourStep(i, autoplay, false);
      else {
        // Advancement changes without rerunning the chapter, resetting its camera, or restoring its temporary options.
        clearTimeout(tour.timer); tour.timer = 0; tour.autoplay = autoplay && !reduce; tour.toast = false;
        hush(); tourSchedule(); tourEvent();
      }
      return tourState();
    };
    // the cutaway for the page, the keys and the tour: diskSlice(on, sq, cut) with cut 'half' or 'quarter' (or 1, 2;
    // the last one used when omitted). Opening flies to a close view of the inner disk as the planes sweep in: low for
    // the 1/2 cut, where the face shows the layers (6 degrees, 2.4 au), higher for the 1/4 cut, which opens the interior
    // in depth (CUT_VIEW); a change of cut while open turns the planes and flies to the other view; closing flies back
    // to the view before as they sweep out.
    const CUT_VIEW = { half: { el: 6, d: 2.4 }, quarter: { el: 24, d: 3.4 } };
    let sliceBefore = null;
    box.diskSlice = (on, sq, cut) => {
      if (sq && sqOf(sq)) opt.sliceQ = sqOf(sq);
      const kind = cut === 2 || cut === 'quarter' ? 'quarter' : cut === 1 || cut === 'half' ? 'half' : opt.cut;
      if (on && !opt.slice) {
        const st = box.diskState(); sliceBefore = { el: st.el, az: st.az, d: st.d, p: st.p, tx: st.tx, ty: st.ty, tz: st.tz };
        box.diskSet({ slice: kind === 'quarter' ? 2 : 1, ...CUT_VIEW[kind], tx: 0, ty: 0, tz: 0, fly: 1 });
      } else if (on && kind !== opt.cut) box.diskSet({ slice: kind === 'quarter' ? 2 : 1, ...CUT_VIEW[kind], fly: 1 });
      // (back to the view before; to the usual view when the cut was opened by a link or a script, with no view kept)
      else if (!on && opt.slice) { box.diskSet({ slice: 0 }); box.diskSet({ ...(sliceBefore || { p: 0, el: VIEWS[0][0], az: VIEWS[0][1], d: VIEWS[0][2] }), fly: 1 }); sliceBefore = null; }
      touched(); emitState();
    };
    box.diskField = (on) => box.diskSet({ field: on ? 1 : 0 });
    box.diskAnnotations = (on) => box.diskSet({ ann: on ? 1 : 0 });
    box.diskLook = (look) => { box.diskSet({ look }); emitState(); };
    box.diskPlay = (on) => { paused = !on; touched(); };
    // (round 7, for checks and the notes) the model's temperature at R (au) and z (au) with the planets' gaps as they are:
    // { T, Tmid, x (ln tau*), snow (the snow line's radius), rTI (the turbulent inner disk's edge) }
    box.diskTemp = (R, z = 0) => { const x = lnTauJS(R, z); return { T: tempJS(R, z / Hof(R), x, lumNow), Tmid: tMidJS(R, lumNow), x, snow: rSn, rTI: NONIDEAL.R_TI }; };
    // (the speed as diskSet takes it: a finite number, positive, 0.1 to 10; the zoom's factor finite and positive, 0.01
    // to 100, the distance then held within its range: anything else is left out)
    box.diskSpeed = (x) => { const st = checked({ speed: x }); if (st.speed != null) speed = st.speed; };
    box.diskZoom = (f) => { const k = typeof f === 'number' || typeof f === 'string' ? Number(f) : NaN; if (isFinite(k) && k > 0) zoomBy(Math.min(100, Math.max(0.01, k))); };
    // for checks: render n frames (the model clock advances 0.05 per frame) and return the cost of a frame
    // in ms (medians), with the canvas size, render scale and steps they were measured at:
    //   gpu   GPU time of one frame (EXT_disjoint_timer_query_webgl2), measured one frame at a time with
    //         the GPU idle at its start: with frames queued back to back, ANGLE's Metal backend counts the
    //         wait behind the earlier frames, so the old batched queries grew with the queue (n = 20 gave
    //         eight times the true time)
    //   wall  time per frame of n frames submitted back to back, each read back (one pixel, asynchronously)
    //         so that it is shaded in full: a tile-based GPU otherwise shades only the last of several
    //         full-screen draws into the same buffer; includes the JavaScript time when that dominates
    //   cpu   JavaScript time of a frame (uniforms, field lines, overlay); field: drawField alone
    // Waits use a MessageChannel, since timers are throttled in hidden pages (requestAnimationFrame stops).
    box.diskBench = async (n = 20) => {
      if (lost) return null;
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const med = (a) => { const s = a.filter((v) => !isNaN(v)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
      const r2 = (v) => Math.round(v * 100) / 100;
      const mc = new MessageChannel(); let wake = null;
      mc.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
      const tick = () => new Promise((r) => { wake = r; mc.port2.postMessage(0); });
      const px1 = new Uint8Array(4), cpu = [], fld = [], gpu = [];
      const one = () => { const c0 = performance.now(); time += 0.05; update(); draw(); cpu.push(performance.now() - c0); fld.push(fieldMs); };
      benching = true; fullFrame++;
      try {
        one(); one(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);   // warm up
        cpu.length = 0; fld.length = 0;
        let disjoint = null;
        if (ext) {
          gl.getParameter(ext.GPU_DISJOINT_EXT);
          for (let i = 0; i < n; i++) {
            const q = gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, q); one(); gl.endQuery(ext.TIME_ELAPSED_EXT); gl.flush();
            const t0 = performance.now();
            while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && performance.now() - t0 < 3000) await tick();
            gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : NaN);
            if (!isNaN(gpu[gpu.length - 1])) piece('bench', gpu[gpu.length - 1], null);
            gl.deleteQuery(q);
          }
          disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        }
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        const w0 = performance.now();
        for (let i = 0; i < n; i++) {
          one();
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        const wall = (performance.now() - w0) / n;
        piece('bench', wall, null, { wall: 1 });
        gl.deleteBuffer(pbo);
        const ok = gpu.filter((v) => !isNaN(v));
        return { gpu: r2(med(ok)), gpuMin: ok.length ? r2(Math.min(...ok)) : NaN, wall: r2(wall), cpu: r2(med(cpu)), field: r2(med(fld)),
          n: ok.length, disjoint, size: [rW, rH], scale: opt.scale, steps: Math.round(opt.steps * (opt.dist < 10 ? 2 : 1)) };
      } finally { benching = false; fullFrame--; dirty = true; }
    };
    // The volume's render scale (the canvas has the screen's pixels), 0.1..1: at least a tenth of the resolution,
    // at most the full screen resolution so external input cannot request an unbounded framebuffer. No argument reads it.
    box.diskScale = (sc) => { if (sc == null) return opt.scale; const n = finiteNumber(sc); if (isFinite(n) && n > 0) { opt.scale = Math.min(1, Math.max(0.1, n)); rescale(); } return opt.scale; };
    // draws until every flight, fade and sweep has finished (at most maxMs): for scripts and tests, and it works in a
    // hidden page too, where no animation frames come. Each frame is waited for (a pixel read back), so that frames do
    // not pile up on the GPU when they are slow.
    // (in two rounds: everything comes to rest, then the automatic exposure and the CO line's range start again from their
    // base and find their levels on the settled picture, so that a state's picture does not depend on the way it was
    // reached, nor on the frames of a flight or a sweep on the way: a link, a check, a still; but a CO range held across a
    // change of the components stays, as it is meant to)
    const aeRestart = () => {
      aeLn = aeGoal = 0; aeTries = 0; aeLo = -Infinity; aeHi = Infinity; aeFresh = false; aeGen++;
      if (!coHold && !coPending && coSavedKey !== coKey) { coLn = coGoal = 0; coTries = 0; coLo = -Infinity; coHi = Infinity; coFresh = false; coGen++; }
    };
    // (round 9: FULL warmed first, and each frame through the engine's guard and in its bands, each band waited for; the
    // animation frames draw nothing meanwhile. It drew whole frames: 0.9 s in the cut at a fixed level, round 9's checks)
    box.diskSettle = async (maxMs = 5000) => {
      if (lost) return false;
      const t0 = performance.now();
      stepping++;
      try {
        await warmNow(maxMs);
        const st = {};
        for (let round = 0; round < 2; round++) {
          if (round === 1) aeRestart();
          for (;;) {
            await scriptFrame('settle', st); if (lost) return false;
            if (!busy() || performance.now() - t0 > maxMs) break;
          }
        }
      } finally { stepping--; }
      dirty = true;
      return !busy();
    };
    // A positive, finite step budget, rounded to 1..320 (the shader's static march limit); no argument reads it.
    box.diskSteps = (n) => { if (n == null) return opt.steps; const k = finiteNumber(n); if (isFinite(k) && k > 0) { opt.steps = Math.min(320, Math.max(1, Math.round(k))); touched(); } return opt.steps; };
    // a PNG of the current frame: the volume plus the overlay (lines, snow line, scale bar); with { canvas: true } the
    // canvas it is drawn on instead (for checks: encoding a PNG takes a second or more in a background page)
    // ({ full: true }: at the render scale 1, the screen's resolution, whatever the adaptive scale is meanwhile)
    // (Round 7) { size: k }: a picture with k times the screen's pixels each way (the volume at k times, the lines and
    // labels drawn at that size from their vectors), at most snapMax() (the canvas within the GPU's largest texture,
    // renderbuffer and viewport, and 8192 px); { bands: n } each frame's volume drawn in n bands sent one by one; with
    // either, or { onFrame(i, n) }, the frames are drawn one at a time, each waited for, so that the page can show the
    // progress and the GPU never holds more than one band.
    const snapLimits = () => {
      const p = (k) => { const v = gl.getParameter(k); return Array.isArray(v) || ArrayBuffer.isView(v) ? Math.min(v[0], v[1]) : v; };
      return { texture: p(gl.MAX_TEXTURE_SIZE), renderbuffer: p(gl.MAX_RENDERBUFFER_SIZE), viewport: p(gl.MAX_VIEWPORT_DIMS) };
    };
    box.diskSnapMax = () => {
      const l = snapLimits(), m = Math.min(l.texture, l.renderbuffer, l.viewport, 8192), d = Math.min(window.devicePixelRatio || 1, 2);
      return { k: Math.max(1, Math.floor(100 * m / (Math.max(W, Hh) * d)) / 100), limits: l, screen: [Math.round(W * d), Math.round(Hh * d)] };
    };
    // (round 10a: a wait over HUNG_MS told to the recorder as hung, once, with the band in flight; and its end as late)
    const gpuDone = () => new Promise((res) => {
      const f = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), t0 = performance.now(), rid = lastRid; gl.flush();
      let hung = false;
      const poll = () => {
        if (lost || gl.clientWaitSync(f, 0, 0) !== gl.TIMEOUT_EXPIRED) { gl.deleteSync(f); if (hung) rec({ k: 'late', id: rid, s: 'script', ms: performance.now() - t0 }); res(); return; }
        if (!hung && performance.now() - t0 > HUNG_MS) { hung = true; rec({ k: 'hung', id: rid, s: 'script', key: kindNow(), sc: opt.scale, ms: performance.now() - t0 }); }
        setTimeout(poll, 8);
      };
      poll();
    });
    // (round 7) the cost of a frame as it is drawn now (ms, from its submission to the GPU's end): for the page to plan a
    // large picture with the look and the view it has (the frames' intervals it keeps may be another look's)
    // (round 9: through the engine's guard and in its bands, as diskSettle's; FULL warmed first)
    box.diskCost = async () => {
      if (lost) return NaN;
      await gpuDone(); stepping++;
      try { await warmNow(); return await scriptFrame('cost', {}); } finally { stepping--; dirty = true; }
    };
    // (round 9) the engine's guard (see GFAC): { ms } its budget (0: off), { key, c1 } a kind's frame at scale 1 measured
    // elsewhere (the page's calibration); returns the budget, the factors and what it knows
    box.diskGuard = (o = {}) => {
      const ms = finiteNumber(o.ms), c1 = finiteNumber(o.c1);
      if (isFinite(ms) && ms >= 0) gBudget = ms;
      if (o.fixed != null) gFixed = !!o.fixed;   // (round 10a, dev.5: see guardFrame)
      if (typeof o.key === 'string' && isFinite(c1) && c1 > 0) { gKnown[o.key] = { c: [c1], t: performance.now(), ub: 0, tub: 0 }; gLast = { key: o.key, c1 }; }
      return { ms: gBudget, fixed: gFixed, factors: { ...GFAC }, cut: GCUT, floor: GUARD_FLOOR, slack: GUARD_SLACK, last: { ...gLast } };
    };
    // (round 9, for checks) Where a frame's work goes: one frame of the present view drawn whole, the volume pass writing for
    // each pixel the iterations of the main march (the visible and mid-infrared looks' continuum, the model's march), those
    // after the transmission fell under 1e-9, and log10 of the transmission at the end; read back from the volume's target
    // and summed up (the longest, where, its share after 1e-9, a histogram). In the gas line's look (round 9, at its end):
    // each pixel's iterations, gas samples and groups' updates (coNIt, coNGas, coNGrp), the most of each and the counts of
    // the ray with the most samples. { linear: true }: the gas line's values themselves (the channel's intensity in K, or
    // M0 in K km/s and M1 in km/s), into a target of 32-bit floats, returned whole (values, rW x rH x 4), to compare marches.
    // The picture is drawn anew after it.
    let probeT = null;
    // (one probe's frame: drawn whole, and in the moments' passes (see coGrid) each pass sent on its own and waited for,
    // its time reported as a piece; the animation frames draw nothing meanwhile)
    // (in bands sized as they go, as a script's frames: a pass of the moments at the whole disk's view took some 250 ms whole)
    async function probeFrame(kind, at) {
      accN = 0; probing = kind; coProbeAt = at; stepping++;
      const st = {};
      try {
        await gpuDone(); if (lost) return;   // (the frames before it done first)
        let t = performance.now();
        adaptRows = Math.max(BAND_ROWS, Math.ceil(rH / 4)); adaptAim = 60;
        try { drawOnce(); } finally { adaptRows = 0; adaptAim = 0; }
        const j = await firstBand('probe'); if (lost) return;
        if (j && j.sentAt > t) t = j.sentAt;
        for (;;) {
          await gpuDone(); if (lost) return;
          const now = performance.now(), ms = now - t; piece('probe', ms, j, j && j.stages ? { stage: j.sentStage } : {});
          if (bandJob !== j) break;
          j.rows = rowsAfter(st, j, ms, 60);
          bandStep(); t = performance.now();
        }
      } finally { probing = 0; coProbeAt = -1; stepping--; }
    }
    const readF = (t) => { const px = new Float32Array(rW * rH * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.readPixels(0, 0, rW, rH, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px; };
    const coCounts = (px) => {
      let mIt = 0, mGas = 0, mGrp = 0, at = 0, sIt = 0, sGas = 0, sGrp = 0;
      for (let i = 0; i < rW * rH; i++) {
        const it = px[4 * i], ga = px[4 * i + 1], gr = px[4 * i + 2];
        sIt += it; sGas += ga; sGrp += gr; mIt = Math.max(mIt, it); mGrp = Math.max(mGrp, gr);
        if (ga > mGas) { mGas = ga; at = i; }
      }
      const n = rW * rH;
      return { most: { it: mIt, gas: mGas, grp: mGrp }, at: [at % rW, Math.floor(at / rW)], ofMostGas: { it: px[4 * at], gas: px[4 * at + 1], grp: px[4 * at + 2] }, mean: { it: Math.round(sIt / n), gas: Math.round(sGas / n), grp: Math.round(sGrp / n) } };
    };
    box.diskRayProbe = async (o = {}) => {
      if (lost) return null;
      probeJit = !!o.jitter;   // (round 10a: the next sub-pixel offset of a still's frames, as the clock's frames use)
      await gpuDone();
      const lin = !!o.linear && lookNow === 'co' && fbFloat;
      if (lin && (!probeT || probeT.w < rW || probeT.h < rH)) { if (probeT) { gl.deleteFramebuffer(probeT.fb); gl.deleteTexture(probeT.tex); } probeT = target(Math.max(rW, 1), Math.max(rH, 1), gl.RGBA32F, gl.CLAMP_TO_EDGE); }
      const nPass = coPassesNow();
      try {
        if (lin) { await probeFrame(2, -1); return lost ? null : { size: [rW, rH], mode: opt.coMode, values: readF(probeT) }; }
        // (the moments in passes: each pass's counts, the passes before it drawn as ever; and the sum over the passes)
        if (nPass > 0) {
          const per = [], tot = new Float32Array(rW * rH * 4);
          for (let k = 0; k < nPass; k++) {
            await probeFrame(1, k); if (lost) return null;
            const px = readF(coAccT[k % 2]);
            for (let i = 0; i < px.length; i++) tot[i] += px[i];
            per.push(coCounts(px).most);
          }
          return { size: [rW, rH], co: opt.coMode, passes: per, ...coCounts(tot) };
        }
        await probeFrame(1, -1); if (lost) return null;
        const px = readF(accT);
        if (lookNow === 'co') return { size: [rW, rH], co: opt.coMode, ...coCounts(px) };
        let mx = 0, at = 0, late = 0, sum = 0, n = 0;
        const hist = [0, 0, 0, 0, 0, 0, 0];   // (iterations: <256, <512, <1024, <2048, <4096, <8192, more)
        for (let i = 0; i < rW * rH; i++) {
          const it = px[4 * i]; sum += it; n++;
          hist[Math.min(6, Math.max(0, Math.floor(Math.log2(Math.max(it, 1) / 128))))]++;
          if (it > mx) { mx = it; at = i; late = px[4 * i + 1]; }
        }
        return { size: [rW, rH], longest: mx, at: [at % rW, Math.floor(at / rW)], lateOfLongest: late, logTrOfLongest: +px[4 * at + 2].toFixed(1), mean: Math.round(sum / n), hist };
      } finally { accN = 0; dirty = true; probeJit = false; }
    };
    // (round 9, for checks) FULL linked, and warmed (see fullWarm)
    box.diskWarm = () => ({ linked: !!full, warm: fullWarm });
    // (round 10a) the picture's health measured after the next frame drawn (see HEALTH_FS); the result in 'diskhealth'
    // (at once on the picture there if no frame is being drawn: a finished still draws no more frames)
    box.diskHealth = () => {
      if (lost || healthSync || gl.isContextLost()) return;
      if (!bandJob && accN > 0 && accT) healthPass({ key: kindNow(), scale: opt.scale, acc: accN, size: [rW, rH] }); else healthWanted = 1;
    };
    // (round 10a) what this context offers, once, for the page's flight recorder: the extensions that change what the engine
    // does (timer queries, the parallel link, float targets, filtering and blending), the limits, the renderer where the
    // browser names it, and the engine's choices from them
    const capsNow = (() => {
      const ex = gl.getSupportedExtensions() || [], has = (n) => ex.includes(n) ? 1 : 0, p = (k) => { try { const v = gl.getParameter(k); return ArrayBuffer.isView(v) || Array.isArray(v) ? Array.from(v) : v; } catch { return null; } };
      let renderer = '';
      try { const d = ex.includes('WEBGL_debug_renderer_info') ? gl.getExtension('WEBGL_debug_renderer_info') : null; renderer = String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { /* not named */ }
      return { renderer, version: String(p(gl.VERSION)), timer: has('EXT_disjoint_timer_query_webgl2'), pcomp: has('KHR_parallel_shader_compile'), fLinear: has('OES_texture_float_linear'),
        cbFloat: has('EXT_color_buffer_float'), cbHalf: has('EXT_color_buffer_half_float'), fBlend: has('EXT_float_blend'), maxTex: p(gl.MAX_TEXTURE_SIZE), max3D: p(gl.MAX_3D_TEXTURE_SIZE),
        maxRB: p(gl.MAX_RENDERBUFFER_SIZE), maxDB: p(gl.MAX_DRAW_BUFFERS), maxView: p(gl.MAX_VIEWPORT_DIMS), nb3: NB3, fbFloat: fbFloat ? 1 : 0, nExt: ex.length };
    })();
    box.diskCaps = () => ({ ...capsNow });
    // (round 10a, for checks only: the volume's picture as it is in accT, rW x rH x 4 floats, by a read back that waits for the
    // GPU; to look for values not finite and where they are)
    box.diskAccRead = () => (lost || !accT ? null : { size: [rW, rH], scale: opt.scale, key: kindNow(), acc: accN, data: readF(accT) });
    // (round 10a, for checks only: one texel of accT set to v ([r, g, b, a], NaN and Infinity allowed, as half floats) and the
    // picture shown again (the display pass alone, see present), to see what such a value looks like on the screen; a still
    // being accumulated keeps it, as a NaN blended with anything stays NaN)
    const toHalf = (f) => {
      if (Number.isNaN(f)) return 0x7e00;
      const sg = f < 0 ? 0x8000 : 0, a = Math.abs(f);
      if (a === Infinity || a > 65504) return sg | 0x7c00;
      if (a < 6.1e-5) return sg | Math.round(a / 5.96e-8);
      const e = Math.floor(Math.log2(a)), m = Math.round((a / 2 ** e - 1) * 1024);
      return sg | ((e + 15) << 10) + Math.min(m, 1023);
    };
    box.diskAccPoke = (x, y, v) => {
      if (lost || !accT) return false;
      gl.activeTexture(gl.TEXTURE6);   // (accT is bound there, for the display)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.HALF_FLOAT, Uint16Array.from(v.map(toHalf)));
      gl.activeTexture(gl.TEXTURE2);
      present();
      return true;
    };
    // (round 9) the march's tier (see MARCH): 'full' or 'cheap'; no argument reads it
    // (round 10a: the costs measured with the other tier no longer hold: forgotten, see firstRows)
    box.diskMarch = (k) => { if (k != null && own(MARCH, k) && k !== march) { march = k; for (const x in gKnown) delete gKnown[x]; kickResetAll(); touched(); } return march; };
    // (for checks: a tier's parameters changed for this page, to try values; returns them)
    box.diskMarchTry = (k, o) => { if (own(MARCH, k) && o && typeof o === 'object') { Object.assign(MARCH[k], o); touched(); } return own(MARCH, k) ? { ...MARCH[k] } : null; };
    // (round 9) the bound on a long ray's work in the CO line and the continuum (CO_IT, CT_IT): on (1, the default) or off
    // (0, as before round 9), to compare pictures; no argument reads it
    box.diskRayBound = (on) => { if (on != null) { rayBound = !!Number(on); touched(); } return rayBound ? 1 : 0; };
    // (round 9, for checks) each piece's own GPU time (see gtBegin): 1 on, 0 off; no argument reads it (0 where the browser
    // has no timer queries)
    box.diskGpuTime = (on) => {
      if (on != null) { gtOn = !!Number(on); if (gtOn) box.dataset.gputime = '1'; else delete box.dataset.gputime; if (gtOn && !gtExt) gtExt = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (gtOn && gtExt) gl.getParameter(gtExt.GPU_DISJOINT_EXT); }
      return gtOn && gtExt ? 1 : 0;
    };
    // (round 9) the frame rate's cap while only the clock moves (see fpsCap): frames a second, 0 for none; no argument reads it
    // (round 9) while only the clock moves, the eddies' volume drawn every n frames (1 to 4; see drawOnce); no argument reads it
    // (round 10a) the GPU's duty (see duty): 0 none, else 0.1 to 1; no argument reads it
    box.diskDuty = (k) => { const v = finiteNumber(k); if (isFinite(v) && v >= 0) duty = v === 0 ? 0 : Math.min(1, Math.max(0.1, v)); return duty; };
    // (round 10a, a switch to try on a phone) the continuum's iterations at most (see uCtMax): 64 to 32768; no argument reads it
    // (round 10a) the march in kicks (see SPLIT): diskSplit() reads { on, k, each, need, state }; diskSplit(0 or 1) turns it off or
    // on; diskSplit({ on, k, each }): k, the work of a kick (in steps of the march), each, one kick a piece (to measure a kick)
    box.diskSplit = (o) => {
      if (o === 0 || o === false) splitOn = false;
      else if (o === 1 || o === true) splitOn = fbFloat;
      else if (o && typeof o === 'object') {
        if (o.on != null) splitOn = !!o.on && fbFloat;
        // (a new work of a kick: what the kicks cost and needed at the old one dropped too. Round 10a: the runaway check's kick of
        // 4096 steps, sized from the cost of a kick of 48, sent a piece of 412 ms, every ray's whole march in its first kick over
        // the rows a cheap kick covers; the engine's guard, which cut it before, no longer cuts a frame in kicks)
        const k = finiteNumber(o.k);
        if (isFinite(k) && k > 0 && Math.min(4096, Math.max(4, Math.round(k))) !== kickK) { kickK = Math.min(4096, Math.max(4, Math.round(k))); kickResetAll(); }
        if (o.adapt != null && !!o.adapt !== kickAdapt) { kickAdapt = !!o.adapt; kickResetAll(); }
        if (o.each != null) kickEach = !!o.each;
        const f1 = finiteNumber(o.first), l1 = finiteNumber(o.least);
        if (isFinite(f1) && f1 >= 0) kickFirstSet = Math.min(32, Math.round(f1));
        if (isFinite(l1) && l1 >= 0) kickLeast = Math.min(64, Math.round(l1));
        if (o.flush === 'kick' || o.flush === 'piece') kickFlush = o.flush;
        const mb = finiteNumber(o.mb); if (isFinite(mb) && mb >= 1 && mb <= 64) { SPLIT.MB = mb; dropState(); }   // (the state's size a set, MB)
      }
      if (o != null) touched();
      return { on: splitOn, k: kickK, adapt: kickAdapt, ks: { ...kickKOf }, each: kickEach, flush: kickFlush, worst: JSON.parse(JSON.stringify(kickWorst)), t: JSON.parse(JSON.stringify(kickT)), need: Object.fromEntries(Object.entries(kickNeed).map(([key, r]) => [key, Math.max(...r)])), broken: Object.keys(splitBroken),
        last: lastJob && lastJob.split ? { key: lastJob.key, K: lastJob.K, kicks: lastJob.kicks || 0, bands: lastJob.bands || 0, bandPieces: lastJob.bandPieces || 0, done: bandJob !== lastJob && !lastJob.cancelled,
          y: lastJob.y, rows: lastJob.rows, n: lastJob.n, ad: !!lastJob.ad, bd: lastJob.bd ? [lastJob.bd.y0, lastJob.bd.y1, lastJob.bd.k] : null, size: [rW, rH] } : null,
        state: stT ? { w: stT.w, h: stT.h, mb: Math.round(2 * stT.w * stT.h * 64 / 1048576 * 10) / 10 } : null };
    };
    // (round 10a) FULL's samplers in use (getActiveUniform) against the fragment shader's units (MAX_TEXTURE_IMAGE_UNITS)
    box.diskSamplers = () => {
      const f = fullProgram();
      if (!f || f === true) return null;
      const T = [gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D], names = [];
      const n = gl.getProgramParameter(f.prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(f.prog, i); if (u && T.includes(u.type)) names.push(u.name); }
      return { max: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), used: names.length, names };
    };
    // (round 10a, for checks) The picture of the march in kicks against the same frame drawn whole: one frame of the present
    // view (paused; the exposure held), drawn whole and then in kicks, each as a script's frame (in the guard's bands), into a
    // target of 32-bit floats, and compared value by value: the share bit for bit the same, the largest and mean difference
    // (round 10a, the coordinator after a frame of 17 bands at a kick of 16 steps differed: o.k, the work of a kick held for the
    // frame in kicks; o.rows, its bands at most so many rows, so that a frame of many bands is compared on purpose)
    box.diskSplitTest = async (o = {}) => {
      if (lost || !fbFloat) return null;
      await gpuDone(); stepping++;
      const was = splitOn, e0 = [aeLn, aeGoal, coLn, coGoal], k0 = kickK, a0 = kickAdapt;
      const kT = finiteNumber(o.k), rT = finiteNumber(o.rows);
      try {
        await warmNow(); if (lost) return null;
        testT = target(rW, rH, gl.RGBA32F, gl.CLAMP_TO_EDGE, gl.NEAREST);
        const w0 = rW, h0 = rH;
        // (round 10a: in a run whose frames took minutes, a frame of 17 bands drawn 330 s after its frame drawn whole differed in
        // some 2500 pixels, the view not settled (diskSettle gave up after 20 s); not seen again in twelve frames of 1 to 21 bands
        // and kicks of 16 to 96 at the same views settled. So no fade moves on in either draw (fadeT: their step, dtR, is the time
        // since the last frame; every fade of the picture goes by it), the exposure and the line's range are those of the start
        // (e0), and the two draws are compared only where no flight is under way nor a look's switch, whose dip goes by the clock)
        if (flyV || flyT || lookNow !== opt.look || lookDip() < 1) return { changed: true, busy: true };
        if (isFinite(kT) && kT > 0) { kickK = Math.min(4096, Math.max(4, Math.round(kT))); kickAdapt = false; kickResetAll(); }
        testRows = isFinite(rT) && rT >= 1 ? Math.round(rT) : 0;
        // (o.maxMs: the test's time; its frame left at the end of it, and { timedOut } returned)
        const mT = finiteNumber(o.maxMs);
        if (isFinite(mT) && mT > 0) testTm = setTimeout(() => { testLate = true; if (bandJob) cancelJob(); }, mT);
        const run = async (on) => { splitOn = on && fbFloat; [aeLn, aeGoal, coLn, coGoal] = e0; accN = 0; fadeT = 0; const ms = await scriptFrame('splittest', {}); return { ms, px: lost ? null : readF(testT), split: lastJob ? !!lastJob.split : false, kicks: lastJob ? lastJob.kicks || 0 : 0, bands: lastJob ? lastJob.n : 0, K: lastJob ? lastJob.K : 0, cancelled: !!(lastJob && lastJob.cancelled) }; };
        const a = await run(false); if (testLate) return { timedOut: true, at: 'whole' };
        const b = await run(true); if (testLate) return { timedOut: true, at: 'kicks', kicks: b.kicks, bands: b.bands };
        if (!a.px || !b.px) return null;
        // (the volume's size changed under the test (a scale set by the page or the guard), or a frame left: nothing to compare)
        if (rW !== w0 || rH !== h0 || a.cancelled || b.cancelled) return { changed: true, size: [w0, h0, rW, rH] };
        let same = 0, mx = 0, sum = 0, nd = 0, nan = 0, at = -1;
        for (let i = 0; i < a.px.length; i++) {
          const x = a.px[i], y = b.px[i];
          if (Object.is(x, y)) { same++; continue; }
          if (!isFinite(x) || !isFinite(y)) { nan++; continue; }
          const d = Math.abs(x - y); nd++; sum += d; if (d > mx) { mx = d; at = i >> 2; }
        }
        return { size: [rW, rH], key: kindNow(), scale: opt.scale, whole: { ms: Math.round(a.ms), split: a.split }, kicks: { ms: Math.round(b.ms), split: b.split, kicks: b.kicks, bands: b.bands, k: b.K },
          n: a.px.length, same, differ: nd, nonFinite: nan, max: mx, mean: nd ? sum / nd : 0, at: at >= 0 ? [at % rW, Math.floor(at / rW)] : null };
      } finally {
        splitOn = was; [aeLn, aeGoal, coLn, coGoal] = e0; testRows = 0; clearTimeout(testTm); testTm = 0; testLate = false;
        if (kickK !== k0 || kickAdapt !== a0) { kickK = k0; kickAdapt = a0; kickResetAll(); }
        if (testT) { gl.deleteFramebuffer(testT.fb); gl.deleteTexture(testT.tex); testT = null; }
        stepping--; accN = 0; dirty = true;
      }
    };
    // (round 10a, for checks) the engine's loops and queues now: the pieces in flight, the GPU timings waiting, the frame in bands,
    // the animation frame asked for, the timers, the warm, and the automatic exposure's state: for state that piles up in a long
    // session (the coordinator, after a full run's frames took 84 ms of script each)
    box.diskLoops = () => ({ flight: flight.length, gtPend: gtPend.length, bandJob: bandJob ? { key: bandJob.key, split: !!bandJob.split, still: !!bandJob.still } : null, frameRequest: frameRequest !== null, running, gpuTimer: !!gpuTimer, gtTimer: !!gtTimer, warmSync: !!warmSync, accN, scale: opt.scale,
      ae: { ln: Math.round(aeLn * 1000) / 1000, goal: Math.round(aeGoal * 1000) / 1000, fresh: aeFresh, tries: aeTries, held: aeHeld(), on: aeOn(), seen: aeSeen }, busy: busy() });
    box.diskCtMax = (n) => { const v = finiteNumber(n); if (isFinite(v) && v > 0) { ctMax = Math.min(32768, Math.max(64, Math.round(v))); touched(); } return ctMax; };
    box.diskEddyEvery = (n) => { const k = finiteNumber(n); if (isFinite(k) && k >= 1) eddyEvery = Math.min(4, Math.round(k)); return eddyEvery; };
    box.diskFps = (n) => { const k = finiteNumber(n); if (isFinite(k) && k >= 0) fpsCap = Math.min(240, k); return fpsCap; };
    // (round 9) the bands of a still picture's frames (see bandsFor): n (1 to 64), and the GPU time aimed at for one (ms), past
    // twice which the engine cuts the next frames into more; no argument reads them
    box.diskBands = (n, ms) => {
      const k = finiteNumber(n), m = finiteNumber(ms);
      if (isFinite(k) && k >= 1) stillBands = pageBands = Math.min(64, Math.round(k));
      if (isFinite(m) && m >= 0) stillBandMs = m;
      return { n: stillBands, ms: stillBandMs };
    };
    // the picture accumulated so far, shown again (the display pass alone; its uniforms are those of the last frame)
    const present = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(progShow); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    let snapLog = null;   // (the last stepwise snapshot: its frames' bands and times, for checks: diskSnapLog)
    box.diskSnapLog = () => snapLog;
    box.diskSnapshot = async (o = {}) => {
      if (lost) return null;   // (no picture without a context)
      // (round 9: every snapshot one frame at a time, each band in a task of its own and waited for, so that no piece of GPU
      // work is long and the browser can show its own frames between them; the animation frames draw nothing meanwhile)
      const sc0 = opt.scale, k = o.size > 1 ? Math.min(o.size, box.diskSnapMax().k) : 1;
      snapBands = Math.max(1, Math.min(64, Math.round(o.bands || 1)));
      snapping = true;
      try {
      // (round 9: the planned scale first, so that nothing is drawn at the larger size with the scale before)
      if (k !== 1) { if (o.scale) opt.scale = Math.min(1, Math.max(0.1, o.scale)); snapK = k; resize(); }
      if (o.full && opt.scale < 1) { opt.scale = 1; rescale(); }
      // (Disk Lab v2) { scale }: at that render scale (0.1 to 1); and each frame is sent to the GPU on its own (flush): the
      // frames queued at once had made one piece of GPU work of several seconds in the CO line's moments, and the system
      // stops the GPU's work beyond a couple of seconds (the WebGL context is lost)
      else if (o.scale && Math.abs(o.scale - opt.scale) > 1e-3) { opt.scale = Math.min(1, Math.max(0.1, o.scale)); rescale(); }
      // (round 9) FULL warmed first; and at least the bands the engine's guard asks for at this scale and size (see
      // guardFrame), for the look in view and the one asked for
      await warmNow(); if (lost) return null;
      if (gBudget > 0) {
        const kOpt = opt.look + (opt.look === 'co' ? ':' + opt.coMode : '') + (opt.slice || sliceU > 0 ? ':cut' : '');
        const p0 = Math.max(gC1(kindNow()), gC1(kOpt)) * opt.scale * opt.scale * snapK * snapK;
        snapBands = Math.min(64, Math.max(snapBands, Math.ceil(2 * p0 / gBudget)));
      }
      fullWait = true;
      // (each frame waited for, stepwise: where a band took more than twice o.bandMs, the next frames are cut into more
      // bands; the last one too, and then the finished picture is shown once more (present: the display pass alone, cheap)
      // in the same task as the read back below, since after a wait the browser may have shown and cleared the drawing
      // buffer, and a read back that waits for a whole heavy frame holds the GPU's process for its whole time)
      const n = o.frames || ACC_SNAP;
      snapLog = { k, scale: opt.scale, size: [canvas.width, canvas.height], bands: [], ms: [], band: [] };
      // (round 9: each band's rows from the dearest rows so far, aiming at half of bandMs or the budget; see rowsAfter. The
      // first band no larger than the bands asked for or the guard's would be)
      const bm = o.bandMs || 250, aim = 0.5 * (gBudget > 0 ? Math.min(gBudget, bm) : bm), st = {};
      for (let i = 0; i < n; i++) {
        await gpuDone(); if (lost) return null;   // (the frames before it done first)
        const t0 = performance.now();
        adaptRows = Math.min(rowsAfter(st, null, 0, aim), Math.ceil(rH / snapBands)); adaptAim = aim;
        try { draw(); } finally { adaptRows = 0; adaptAim = 0; }
        let j = await firstBand('snapshot'); if (lost) return null;
        let b0 = j && j.sentAt >= t0 ? j.sentAt : t0, bMax = 0, sum = 0;
        for (;;) {
          await gpuDone(); if (lost) return null;
          const now = performance.now(), ms = now - b0; bMax = Math.max(bMax, ms); sum += ms; piece('snapshot', ms, j);
          if (bandJob !== j) break;
          if (j.split) { j.bandMs = (j.bandMs || 0) + ms; j.lastMs = ms; j.st = st; j.aim = aim; while (!lost && bandJob === j && !splitReady(j)) await new Promise((r) => setTimeout(r, 16)); if (lost) return null; if (bandJob !== j) break; }   // (round 10a: see scriptFrame)
          else j.rows = rowsAfter(st, j, ms, aim);
          bandStep(); b0 = performance.now();
        }
        const dt = performance.now() - t0;
        snapLog.bands.push(j ? j.n : 1); snapLog.ms.push(Math.round(dt)); snapLog.band.push(Math.round(bMax));
        if (j && !j.first && !document.hidden) gNote(j.key.replace(/:F$/, ''), sum, opt.scale * snapK, j.n || 1, bMax, /:F$/.test(j.key));
        if (o.onFrame && i < n - 1) o.onFrame(i + 1, n);
      }
      present();
      fullWait = false;
      const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const c2 = out.getContext('2d'); c2.drawImage(canvas, 0, 0);
      const sv = overlay.cloneNode(true);
      sv.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); sv.setAttribute('width', out.width); sv.setAttribute('height', out.height);
      const style = (sel, attrs) => sv.querySelectorAll(sel).forEach((el) => { for (const k in attrs) el.setAttribute(k, attrs[k]); });
      style('.disk-snowline', { stroke: 'rgba(190,215,240,0.55)', 'stroke-width': 1, 'stroke-dasharray': '3 5' });
      style('.disk-scale line', { stroke: 'rgba(190,215,240,0.85)', 'stroke-width': 1 });   // (the halo's own style, inside the overlay, wins)
      style('text', { fill: 'rgba(190,215,240,0.85)', 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': 11, 'letter-spacing': '0.04em' });
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(sv)], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      c2.drawImage(img, 0, 0, out.width, out.height); URL.revokeObjectURL(url);
      if (o.canvas) return out;
      return new Promise((res) => out.toBlob(res, 'image/png'));
      } finally {
        fullWait = false; snapBands = 1; snapping = false; bandJob = null; dirty = true;
        if (snapK !== 1) { snapK = 1; opt.scale = sc0; resize(); } else if (opt.scale !== sc0) { opt.scale = sc0; rescale(); }
      }
    };
  }
  // Panels narrower than 700 px keep the static picture: a finger drag would fight page scrolling,
  // and phone GPUs should not pay for the ray march.
  const phone = window.matchMedia('(max-width: 699px)').matches;
  // A panel with data-mobile opts in to WebGL on narrow screens (used by the preview page).
  // If setting up fails part way, the canvas and overlay come out again so the static picture shows.
  document.querySelectorAll('[data-disk3d]').forEach((box) => {
    if (phone && !('mobile' in box.dataset)) { box.classList.add('disk-fallback'); return; }
    try { init(box); } catch (e) { box.querySelectorAll(':scope > canvas, :scope > .disk-overlay').forEach((el) => el.remove()); box.dataset.fallbackError = String((e && e.message) || e).slice(0, 240); box.classList.add('disk-fallback'); console.error(e); }
  });
})();
