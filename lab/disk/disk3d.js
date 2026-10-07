// Volume rendering of a model protoplanetary disk (out to its edge at 30 au), drawn on the GPU.
//
// The structure follows an irradiated, magnetically accreting disk:
//   gas        Σ ∝ R^-1 out to a density cutoff at 30 au, vertically Gaussian with H/R = 0.03 (R/au)^1/4
//              (T_mid ∝ R^-1/2); the tapering edge lies in the shadow of the flared disk
//   rotation   Keplerian, Ω ∝ R^-3/2
//   coupling   the gas is weakly ionized, so the field slips through it (non-ideal MHD, see NONIDEAL): Ohmic
//              diffusion leaves a dead zone about the midplane, and ambipolar diffusion keeps the surface above it
//              laminar; only the thermally ionized innermost disk (inside 0.3 au) is turbulent (the
//              magnetorotational instability), in sheared structure and eddies in three dimensions through the
//              whole column (see CELLS3)
//   heating    starlight grazes the flared surface and is absorbed where the optical depth toward
//              the star reaches unity, a few scale heights up; that thin skin is hot and bright,
//              while the midplane stays cool (T_mid = 150 K at 1 au), so the water snow line sits
//              near 1 au as in a magnetically accreting disk
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
  const MODEL = { R_IN: 0.08, H0: 0.03, R_OUT: 30.0, P_OUT: 6.0, LNTAU1: 8.5, TICE: 160.0, K_D: 1200.0, SD0: 0.012 };
  const G = (v) => Number.isInteger(v) ? v.toFixed(1) : String(v);   // a JS number as a GLSL float literal
  // The marched region: a cylinder past the disk's edge (RB) and up to the top of the drawn wind (ZB), in au. The disk was
  // 8 au in radius until the seventh round, 30 au since; the outer parts of the picture that scale with it (the wind's and
  // the envelope's softened falloffs with distance, the zoom range, the views) were scaled by about 3.75 with it.
  const RB_JS = 40, ZB_JS = 30;
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
  //     reach the midplane, so the whole column couples; the outer disk out to 30 au is laminar by ambipolar diffusion.)
  //     For a surface density of 1700 g cm^-2 at 1 au (the minimum-mass solar nebula), 2.5 H leaves about 10 g cm^-2
  //     above it, the depth to which the star's X-rays ionize the gas (Igea & Glassgold 1999). Inside R_TI = 0.3 au the disk is taken as
  //     hot enough (above about 1000 K) for alkali metals to be thermally ionized, so the whole column couples. (The
  //     passive midplane temperature of this model reaches 1000 K only near the star; the inner edge of the dead zone
  //     is placed where models with accretion heating put it, a choice for the picture.)
  //   Ambipolar diffusion dominates at low density, in the surface layers: the ambipolar Elsasser number Am is of order
  //     one there, so the field couples (currents flow, the field bends, and the wind's torque drives accretion) but
  //     the magnetorotational instability is suppressed: the surface is laminar. Above the irradiation surface the
  //     star's far-ultraviolet light ionizes the gas (Am >> 1) and the wind is launched.
  // So the disk is laminar everywhere except inside R_TI, where the magnetorotational instability stirs the whole
  // column; across the dead zone the field lines are vertical up to z_k and bend there into the wind (see fieldRP and
  // tools/bp-wind/kink.py, which solves the steady induction equation in height to check the shape: the bend is
  // concentrated within about BEND = 0.6 H above z_k, and the current there drives the accretion).
  const NONIDEAL = { R_TI: 0.3, R_DZ: 7.5, Q: 1.55, BEND: 0.6, TI: 12 };
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
  const ACC = { K_SYM: 2, K_ASYM: 4, W: 0.3, OFF: 0.15, SIG: 0.02, R_END: 0.4 };
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
  // is a (q/3)^1/3 = 0.21 au. It opens a gap in the gas, a Gaussian dip in Σ, Σ (1 - depth e^-x²) with x = (R - a)/W,
  // of width (sigma) W = 1.8 Hill radii (FWHM 0.88 au = 4.2 Hill radii). Its depth is a choice for the picture and
  // depends on how close the camera is (DEPTH): 0.3 from afar, so that the usual view is not dominated by a dark ring,
  // and 0.98 close up, nearer what a Jupiter would clear in a disk this thin (H/R = 0.04 at 3 au: Σ_min/Σ_0 ~ 0.003 and
  // a width of ~0.8 a for alpha = 1e-3; Kanagawa et al. 2015, 2016). Everything that follows from the gap takes the
  // same depth: the starlight on it, the pebbles (filtered out of the gap, and collected at the pressure maximum just
  // outside it once the gap is deep enough to make one, see trapOf), the wind launched from it, the wake and the slice.
  // The wake, the spiral density wave the planet launches, follows Rafikov (2002) in shape; its amplitude is the
  // physical one (WAKE_P at WAKE_X0 from the orbit, decaying away from it), or exaggerated on demand (WAKE_A, WAKE_L:
  // the waves' emphasis, opt.waves; see wake in the disk map), and, like the gap, drawn weaker from afar
  // (DEPTH.WAKE_FAR). Close up, the planet and its circumplanetary disk (out to 0.4 Hill radii) show.
  const PLANET = (() => {
    const A = 3.0, Q = 1e-3, RH = A * Math.cbrt(Q / 3), W = 1.8 * RH;
    return { A, Q, RH, W, HP: MODEL.H0 * Math.pow(A, 0.25), PHI0: 2.4, WAKE_A: 3.5, WAKE_L: 0.6, WAKE_P: 1, WAKE_X0: 0.1 };
  })();
  // the gap's depth: FAR when the camera is beyond D1 au from the planet's orbit (the circle R = a in the midplane;
  // the usual view is at 23 au), NEAR within D0, eased in between. The distance to the orbit rather than to the planet,
  // so that the depth does not change as the planet goes round (seen from near the star, as in the slice). The wake's
  // strength follows the same function, from WAKE_FAR of its amplitude afar to all of it near, so that from the usual
  // view its arms do not stand out as rings (made for the exaggerated amplitude, and kept with the physical one). Both
  // are choices for the picture.
  const DEPTH = { FAR: 0.3, NEAR: 0.98, D0: 4, D1: 18, WAKE_FAR: 0.2 };
  const GL_R0 = 1.8, GL_DR = 7.6 / 127;   // radii of the table of starlight on the gap (see gapLightTables)
  const WIND_LOW_JS = 0.1;                // the weaker side of the wind relative to the stronger, with the asymmetry (see uWindLow)
  const ASYM_F_JS = 0.5;                  // the dead zone's horizontal field with the asymmetry, as a share of the wind's (see bendQ)
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
  const ENV = { R: 560, TH_CAV: Math.PI / 6, SPEED: 220, NS: 18 };
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
  const FIELD_GLSL = `
uniform vec4 uTab[64];                  // (xi, PHI, TAU, ln ETA) at chi_i = C0 (e^(s_i) - 1), s_i = i SMAX / 63
const float C0 = ${G(BP.C0)}, SMAX = ${G(BP.SMAX)}, CHIMAX = ${G(BP.CHIMAX)};   // the solution goes on to chi = 134
const float A0 = ${G(BP.A0)}, B0 = ${G(BP.B0)};  // dR/dz and B_phi/B_z where the line leaves the surface
float cutOut(float R){ return pow(R / R_OUT, P_OUT); }      // -ln of the density cutoff
float zBase(float Rf){ float H = H0 * pow(Rf, 1.25); return H * sqrt(2.0 * max(${G(MODEL.LNTAU1)} - 1.25 * log(Rf) - cutOut(Rf), 1.0)); }
vec4 tabF(float f){ f = clamp(f, 0.0, 62.999); int i = int(f); return mix(uTab[i], uTab[i + 1], f - float(i)); }
vec4 tabAt(float chi){ return tabF(log(1.0 + chi / C0) * (63.0 / SMAX)); }
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
  float q = hi <= zk ? 0.0 : hi < zk + d ? 0.5 * (hi - zk) * (hi - zk) / d : hi - zk - 0.5 * d;
  return q + s * (hi - q);
}
float r0Of(float Rf, float s){ float zb = zBase(Rf); return Rf + A0 * bendQ(Rf, zb, zb, s); }   // the radius at the wind's base
// radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf, at height h on the side of s
vec2 fieldRP(float Rf, float h, float s){
  float zb = zBase(Rf), q = bendQ(Rf, h, zb, s);
  vec2 rp = vec2(Rf + A0 * q, B0 * q / Rf);
  if (h > zb) { vec4 t = tabAt((h - zb) / rp.x); rp = vec2(rp.x * t.x, rp.y + t.y); }
  return rp;
}
// foot radius of the line through (R, h): R(Rf) is monotonic at fixed h (nested lines, also where they
// turn back toward the axis), so bisect (once per point of the wind map, so to full precision)
float footRadius(float R, float h, float s){
  float lo = 0.05, hi = max(R, 0.05) + 2.0 * A0 * ASYM_F * H0 * pow(max(R, 0.05), 1.25) * 4.0;
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
const float OMEGA0 = 0.5236;            // 2π / 12 s at 1 au (visual time)
const float MAG_RS = ${G(MAG.RS)}, MAG_RT = ${G(MAG.RT)};   // the star's radius and the magnetosphere's (au; see MAG)
const float MAG_DL = ${G(MAG.DL)};   // the curtains' bundle of lines: L from MAG_RT to MAG_RT (1 + MAG_DL)
// the curtains' density across the magnetic azimuth, from a curtain's middle (dph): cos^2(dph / 2) cubed, half at 54
// degrees: two broad arcs, as the funnel flows of a slightly tilted dipole (Romanova et al. 2003, 2004), not narrow streams
float magAz(float dph){ float c = 0.5 + 0.5 * cos(dph); return c * c * c; }
const float RB = ${G(RB_JS)}, ZB = ${G(ZB_JS)};   // marched cylinder (au): past the edge of the disk, up to the top of the drawn wind
// non-ideal MHD (see NONIDEAL in the script): the thermally ionized inner disk inside R_TI, the dead zone's top z_k (in
// units of H; 0 where there is none) and the height over which the field bends above it (DZ_BEND H)
const float R_TI = ${G(NONIDEAL.R_TI)}, R_DZ = ${G(NONIDEAL.R_DZ)}, DZ_Q = ${G(NONIDEAL.Q)}, DZ_BEND = ${G(NONIDEAL.BEND)}, DZ_TI = ${G(NONIDEAL.TI)};
float mriAmp(float R){ return 1.0 - smoothstep(0.75 * R_TI, 1.15 * R_TI, R); }   // where the magnetorotational instability stirs the gas
float zKinkH(float R){ return sqrt(2.0 * max(DZ_Q * log(R_DZ / R) - 0.5 * pow(R / R_OUT, P_OUT) - DZ_TI * mriAmp(R), 0.0)); }
// the surface accretion layer (see ACC in the script): centred ACC_OFF H above the dead zone's top, ACC_W H wide, where
// there is a dead zone below it (accAmp)
const float ACC_W = ${G(ACC.W)}, ACC_OFF = ${G(ACC.OFF)}, ACC_SIG = ${G(ACC.SIG)};
float accAmp(float R){ return smoothstep(0.4, 1.0, zKinkH(R)); }
`;
  const PLANET_GLSL = `
// the planet (see PLANET in the script): uPlanet is the depth of its gap (Σ is lowered by the factor 1 - uPlanet e^-x²;
// it depends on the camera's distance and fades in and out with the planet), uPlanetPhi its azimuth. uTrap: the radius
// of the pressure maximum outside the gap, the fraction of the pebbles filtered out of the gap and the strength of their
// trap at that maximum (see trapOf in the script).
uniform float uPlanet;
uniform float uPlanetPhi;
uniform float uWake;        // the wake's strength (0 to 1): the planet's presence times the strength for the camera's distance
uniform float uWakeX;       // the waves' emphasis (0: the wake's physical amplitude, 1: exaggerated; eased), see wake
uniform vec3 uTrap;
uniform vec3 uPlanetPos;
uniform float uPlanetVis;   // the planet and its disk shown close up (see planetLight)
const float R_CPD = ${G(+(0.4 * PLANET.RH).toFixed(4))};   // radius of the planet's disk, 0.4 Hill radii
const float A_P = ${G(PLANET.A)}, GAP_W = ${G(+PLANET.W.toFixed(5))}, HP = ${G(+PLANET.HP.toFixed(5))};
const float WAKE_A = ${G(PLANET.WAKE_A)}, WAKE_L = ${G(PLANET.WAKE_L)}, WAKE_P = ${G(PLANET.WAKE_P)}, WAKE_X0 = ${G(PLANET.WAKE_X0)};
// the factor by which the gap lowers Σ, and its ln
float gapFactor(float R){
  if (uPlanet <= 0.0) return 1.0;
  float x = (R - A_P) / GAP_W;
  if (abs(x) > 3.5) return 1.0;
  return 1.0 - uPlanet * exp(-x * x);
}
float gapLn(float R){
  if (uPlanet <= 0.0) return 0.0;
  float x = (R - A_P) / GAP_W;
  if (abs(x) > 3.5) return 0.0;
  return log(1.0 - uPlanet * exp(-x * x));
}
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
// detail fades out; time is the moment the structure is taken at (the model clock for the disk, the
// launch for the gas of the wind); cells = (cells around, cells per unit ln R). Returns the relative
// perturbation of the first octave and, with fine = true, that of both octaves and the slope along ln R
// in units of the local wavenumber. (turbL: with a lifetime life/Ω of one's own.)
const float LIFE = 1.5, AGE0 = 0.25;
vec3 turbL(float lnR, float phi, float Om, float fp, float seed, bool fine, float time, vec2 cells, float life){
  float b = log(life / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b));
  vec3 n = vec3(0.0); float w2 = 0.0;
  float tilt = cells.x / TAU / TILT_PITCH;
  for (int j = 0; j < 2; j++) {
    float wb = j == 0 ? 1.0 - bf : bf;
    if (wb <= 0.0) continue;
    float band = floor(b) + float(j), T = exp2(2.0 * band);
    for (int k = 0; k < 2; k++) {
      float c = time / T + 0.5 * float(k) + 0.37 * band;
      float fc = fract(c), age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
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
vec3 turb(float lnR, float phi, float Om, float fp, float seed, bool fine, float time, vec2 cells){ return turbL(lnR, phi, Om, fp, seed, fine, time, cells, LIFE); }
// Strength of the turbulent structure: only in the thermally ionized innermost disk (inside R_TI = 0.3 au), where the
// magnetorotational instability works; elsewhere the disk is laminar (see NONIDEAL)
float turbAmp(float R){ return 1.7 * mriAmp(R); }
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
const float LNW_MIN = ${G(Math.log(0.04))}, LNW_SPAN = ${G(Math.log(70.0 / 0.04))};   // wind map: r from 0.04 to 70 au
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
uniform float uTime;
uniform float uSeed;
uniform vec3 uCam;
uniform float uPixA;    // angular size of a render pixel
// starlight absorbed per unit area with the gap, relative to the smooth disk, at R = GL_R0 + i GL_DR (ray traced in
// the script, see gapLight there)
uniform vec4 uGapLight[32];
${CONST_GLSL}
${PLANET_GLSL}
${FIELD_GLSL}
${NOISE_GLSL}
${TURB_GLSL}
${MAP_GLSL}
const float RELIEF = 0.9;               // brightening per unit slope of the corrugated surface
const float GL_R0 = ${G(GL_R0)}, GL_DR = ${G(GL_DR)};
float gapLight(float R){
  float f = (R - GL_R0) / GL_DR;
  if (uPlanet <= 0.0 || f <= 0.0 || f >= 127.0) return 1.0;
  int i = int(f), j = i + 1;
  return mix(uGapLight[i >> 2][i & 3], uGapLight[j >> 2][j & 3], f - float(i));
}
// The planet's wake (Rafikov 2002, for c_s ∝ R^-1/4; far from the planet it is the linear wake of Ogilvie & Lubow
// 2002): the spiral density wave launched by the planet, trailing outside its orbit and leading inside, along
// phi_w = phi_p + sgn(x - 1) F(x) / h_p with x = R/a, F = 4.8 - 4 x^-1/4 - 0.8 x^5/4 and h_p = H/R at the planet. In this
// thin disk (h_p = 0.04) both arms wind tightly: the outer one comes round again 1.5 au farther out at 4.5 au, the inner
// one 1.2 au farther in at 2 au. Returns the relative excess of the gas density on the crest, out to 0.45 a and 2.3 a.
// Its physical amplitude (uWakeX = 0, the default): WAKE_P (1) at |x - 1| = WAKE_X0 (0.1, 2.5 scale heights from the
// orbit, about the gap's edge), as a planet of some 16 thermal masses (q = 1e-3 against h_p^3 = 6.4e-5) raises crests of
// order unity next to it, its wake shocking within a scale height (Goodman & Rafikov 2001); beyond, the shock's jump
// decays as |x - 1|^-3/4, the local asymptotic form (the N-wave's amplitude falls as t^-1/2 with t ∝ |x - 1|^5/2, on
// top of the linear wave's growth as |x - 1|^1/2; its flux of angular momentum falls as |x - 1|^-5/4; Rafikov 2002):
// 0.3 at 0.5 a from the orbit, 0.18 at a. Exaggerated with the waves' emphasis (uWakeX = 1, the button "波を強調"):
// WAKE_A (3.5) decaying over WAKE_L (0.6 a), at most about 3 at the edge of the gap, so that the arms read as waves.
// The crest is a scale height wide, broadening as the wave travels (its shock widens), and widened further (and lowered, keeping its
// integral) where a texel or the pixel footprint across it is wider. It turns with the planet and grows and fades with
// it; from afar it is drawn weaker, as the gap is drawn shallower (uWake, see DEPTH in the script); inside the gap the
// planet's own disk takes over.
float wake(float R, float phi, float fp){
  float x = R / A_P;
  if (uWake <= 0.0 || x < 0.42 || x > 2.5) return 0.0;
  float F = 4.8 - 4.0 * pow(x, -0.25) - 0.8 * pow(x, 1.25);
  float dphi = phi - uPlanetPhi - sign(x - 1.0) * F / HP;
  dphi = mod(dphi + PI, TAU) - PI;
  float sl = pow(x, 1.25) * abs(pow(x, -1.5) - 1.0) / HP, c = inversesqrt(1.0 + sl * sl);   // R dphi_w/dR, sin of the pitch
  float ax = abs(x - 1.0), w = H0 * pow(R, 1.25) * (1.0 + 0.5 * ax);
  float px = max(fp * R, 1.5 * R * (LNR_SPAN / uMapRes.x * sl + TAU / uMapRes.y) * c);   // footprint across the crest
  float wf2 = w * w + px * px, d = R * dphi * c;
  float amp = mix(WAKE_P * pow(max(ax, WAKE_X0) / WAKE_X0, -0.75), WAKE_A * exp(-ax / WAKE_L), uWakeX);
  return uWake * amp * smoothstep(0.03, 0.10, ax) * smoothstep(0.42, 0.55, x) * (1.0 - smoothstep(2.0, 2.5, x))
       * w * inversesqrt(wf2) * exp(-d * d / wf2);
}
// The streaks of the surface accretion (see ACC in the script): clumps form in the current layer and accrete (Mori, Bai &
// Tomida 2025 find them forming again and again on the accreting surface), sheared into arcs by the rotation and drifting
// inward with the flow, k c_s = k (H/R) R Omega, so a part of the pattern born at ln R_b is at ln R_b - k (H/R) Omega age.
// Two staggered generations living about ACC_LIFE / Omega (in bands, as turbL), one octave, faded below the pixel's
// footprint; a lognormal factor with mean 1 (the noise's standard deviation is 0.215).
const vec2 ACC_CELLS = vec2(20.0, 9.0);
const float ACC_LIFE = 2.0, ACC_TURB = 2.4;
float accTurb(float lnR, float phi, float Om, float fp, float drift, float seed){
  // (lifetimes in bands four times apart, blended in radius, as in turbL: with a lifetime of exactly ACC_LIFE / Omega, as
  // until the seventh round, the generations' phases drifted out of step from one radius to the next as the clock ran,
  // making rings that were not carried by the flow: they moved outward, R / (1.5 t), and thinned)
  float b = log(ACC_LIFE / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b));
  float n = 0.0, w2 = 0.0, tilt = ACC_CELLS.x / TAU / TILT_PITCH;
  for (int j = 0; j < 2; j++) {
    float wb = j == 0 ? 1.0 - bf : bf;
    if (wb <= 0.0) continue;
    float band = floor(b) + float(j), T = exp2(2.0 * band);
    for (int k = 0; k < 2; k++) {
      float c = uTime / T + 0.5 * float(k) + 0.37 * band, fc = fract(c), age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
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
  vec3 n = A > 0.0 ? turb(lnR, phi, Om, fp, uSeed, true, uTime, CELLS) * A : vec3(0.0);
  // cast shadows: the optical depth toward the star builds up mostly over the last part of the ray
  // (R' = t R, t from 0.5 to 1, weighted by the smooth profile), where the turbulence raises or lowers
  // the density. The surface behind a crest is shaded, behind a trough it is lit more strongly.
  float aR = LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R);
  float dtau = 0.0, rPrev = 1.0;
  if (turbAmp(0.5 * R) > 0.0) for (int k = 1; k <= 5; k++) {
    float t = 1.0 - 0.1 * float(k), tm = t + 0.05;
    float r = exp(-1.25 * log(t) - aR * (inversesqrt(t) - 1.0));          // tau*(t) / tau*(1) along the ray
    float At = turbAmp(R * tm);
    float f = At > 0.0 ? exp(1.6 * At * turb(lnR + log(tm), phi, Om * pow(tm, -1.5), fp, uSeed, false, uTime, CELLS).x - 0.08 * At * At) : 1.0;
    dtau += (f - 1.0) * (rPrev - r); rPrev = r;
  }
  float nd = A > 0.0 ? turb(lnR, phi, Om, fp, uSeed + 11.0, false, uTime, CELLS).x : 0.0;
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
  fragAcc = accAmp(R) > 0.0 ? vec4(accTurb(lnR, phi, Om, fp, uAccK.x * hR, uSeed + 61.0), accTurb(lnR, phi, Om, fp, uAccK.y * hR, uSeed + 83.0), 0.0, 0.0) : vec4(1.0);
}`;
  const WINDMAP_FS = `#version 300 es
precision highp float;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragVel;   // the gas velocity in units of v_K(r0): (v_R, v_phi, v_z), for the CO line
uniform vec2 uMapRes;
uniform vec4 uTabV[64];                  // (F, G, XIP) of the wind solution at the rows of uTab
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
  float lnrho = log(RHO_B) - 1.5 * log(r0) + tabAt(max(chi, CHI_C)).w - tabAt(CHI_C).w + min(chi, 0.0) / WIND_BLEED - cutOut(r0)
              - 5.0 * smoothstep(0.55 * ZB, ZB, h) - 5.0 * smoothstep(0.55 * RB, RB, R)
              + log(max(smoothstep(R_IN * 0.8, R_IN * 1.3, r0) * (1.0 - smoothstep(0.85 * ZB, ZB, h)) * (1.0 - smoothstep(0.85 * RB, RB, R)), 1e-30));
  // ln r0, azimuth of the line relative to its foot, travel time of the gas from the base, ln density
  fragColor = vec4(log(r0), fieldRP(Rf, h, s).y, tabAt(max(chi, 0.0)).z, lnrho);
  // the velocity along the line, v_K(r0) (F dxi/dchi, G, F) in (R, phi, z) above the base; below it the gas turns with
  // the disk (Keplerian at R)
  float f = clamp(log(1.0 + max(chi, 0.0) / C0) * (63.0 / SMAX), 0.0, 62.999);
  int i = int(f);
  vec3 t = mix(uTabV[i].xyz, uTabV[i + 1].xyz, f - float(i));
  fragVel = chi > 0.0 ? vec4(t.x * t.z, t.y, t.x, 1.0) : vec4(0.0, sqrt(r0 / max(R, 1e-3)), 0.0, 0.0);   // (v_z: away from the midplane)
}`;
  // The wind's streamers (see windTurb): their cells (a few bundles around the disk and per unit ln r0), lifetime (in
  // units of the disk's) and contrast; WSTR_TAU, the travel time (in 1/Omega(r0)) their texture reaches (the table's
  // last row is 51.4)
  const WSTR_GLSL = `
const vec2 WIND_CELLS = vec2(5.0, 1.6);
const float WIND_TURB = 3.0, WIND_LIFE = 3.0, WSTR_TAU = 52.0;
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
    v[k] = turbL(lnr0, phi - tau, Om, 0.0, uSeed + 23.0, false, uTime - tau / Om, WIND_CELLS, WIND_LIFE * LIFE).x;
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
    float band = floor(b) + float(j), T = exp2(2.0 * band);
    for (int g = 0; g < 2; g++) {
      float c = uTime / T + 0.5 * float(g) + 0.37 * band;
      float fc = fract(c), age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
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
float cbrt(float v){ return sign(v) * pow(abs(v), 1.0 / 3.0); }
// cos theta0 of the streamline through the point at r (au), mu = cos of the polar angle: the root in [mu, 1] of
// m^3 + (x - 1) m - x mu = 0 with x = r / r_c (one real root for x > 1, Cardano; three for x < 1, the largest; then two
// Newton steps)
float envMu0(float r, float mu){
  float x = r / R_OUT;
  float pp = x - 1.0, q = -x * mu, D = 0.25 * q * q + pp * pp * pp / 27.0, m;
  if (D > 0.0) { float sD = sqrt(D); m = cbrt(-0.5 * q + sD) + cbrt(-0.5 * q - sD); }
  else { float pn = min(pp, -1e-6); m = 2.0 * sqrt(-pn / 3.0) * cos(acos(clamp(1.5 * q / pn * sqrt(-3.0 / pn), -1.0, 1.0)) / 3.0); }
  for (int i = 0; i < 2; i++) m -= (m * m * m + pp * m + q) / max(3.0 * m * m + pp, 1e-4);
  return clamp(m, max(mu, 1e-4), 1.0);
}
// ln of the density at r (au), mu = cos of the polar angle
float envLnRho(float r, float mu){
  float x = r / R_OUT, mu0 = envMu0(r, mu);   // x: r in units of r_c
  // density, with the pile-up where the streamlines meet at r_c on the midplane held finite
  float lnrho = -1.5 * log(x) - 0.5 * log(1.0 + mu / mu0) - log(max(mu / mu0 + 2.0 * mu0 * mu0 / x, 0.05));
  // the cavity: streamlines that start within TH_CAV of the axis are emptied (a little gas is left in it)
  float open = 1.0 - smoothstep(cos(TH_CAV + 0.08), cos(TH_CAV - 0.08), mu0);
  return lnrho + log(max(mix(0.015, 1.0, open) * (1.0 - smoothstep(0.65 * ENV_R, ENV_R, r)), 1e-30));
}
`;
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
  const CO_MARCH_GLSL = (name, Q, ret, args, vq, result) => `
${ret} ${name}(vec3 ro, vec3 rd, vec2 b, float tCross, float jitter, ${args}){
  // the intensities and transmissions at the velocities vq(q) (four in a group)
  vec4 I[${Q}], Tr[${Q}];
  for (int q = 0; q < ${Q}; q++) { I[q] = vec4(0.0); Tr[q] = vec4(1.0); }
  // the previous sample: where, opacity (per au), source (K), velocity (km/s), line width (km/s)
  float t = b.x, tP = -1.0, kP = 0.0, sP = 0.0, uP = 0.0, wP = 0.0;
  bool sheetDone = tCross <= b.x || tCross >= b.y;
  for (int i = 0; i < 320; i++) {
    if (i >= uSteps || t > b.y) break;
    vec4 m4 = Tr[0];
    for (int q = 1; q < ${Q}; q++) m4 = max(m4, Tr[q]);
    if (max(max(m4.x, m4.y), max(m4.z, m4.w)) < 3e-4) break;   // (every velocity hidden)
    vec3 p = ro + rd * t;
    float R = max(length(p.xy), 0.05), Hs = H0 * pow(R, 1.25), az = abs(p.z);
    // (the steps as in the other looks, but lengthening smoothly above 4 to 5 scale heights instead of at once: a
    // sample crossing that height moved all the later ones, a seam in a refined still seen face-on)
    float ds = clamp(max(0.4 * Hs, mix(0.18, 0.25, smoothstep(4.0 * Hs, 5.0 * Hs, az)) * az), 0.004, max(0.4, 0.05 * length(p)));
    if (i == 0) ds *= 0.25 + jitter;
    float tm = t + 0.5 * ds;
    vec3 pm = ro + rd * tm;
    vec4 g = coGas(pm, rd);
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
      // the part's line-centre optical depth: the log mean of the opacities (the density changes exponentially); under
      // 1e-4 it adds nothing that shows (a hundredth of a K km/s)
      float kM = max(kA, kB);
      if (kM * L < 1e-4) continue;
      float r = max(min(kA, kB), 1e-4 * kM) / kM, d0 = L * kM * (r > 0.999 ? 1.0 : (r - 1.0) / log(r));
      if (d0 < 1e-4) continue;
      // the profile: the Gaussian averaged over the sweep of velocities (erf), or where the sweep is narrower than two
      // line widths the Gaussian of the same area and variance (the two agree there); the velocities beyond reach get
      // an optical depth under 1e-4 from it, and those already hidden nothing that shows
      float du = uB - uA, uM = 0.5 * (uA + uB), dS = sB - sA, reach = 0.5 * abs(du) + w * sqrt(2.0 * log(d0 * 1e4));
      bool wide = abs(du) > 2.0 * w;
      float g2 = w * w + du * du / 12.0, gk = w * inversesqrt(g2), ek = 0.70710678 / w, ak = 1.2533141 * w / (wide ? du : 1.0);
      for (int q = 0; q < ${Q}; q++) {
        vec4 vv = ${vq}, x = vv - uM;
        if (any(lessThan(abs(x), vec4(reach))) && any(greaterThan(Tr[q], vec4(1e-4)))) {
          vec4 dt = d0 * (wide ? ak * (erfA((vv - uA) * ek) - erfA((vv - uB) * ek)) : gk * exp(-0.5 * x * x / g2));
          vec4 e = exp(-dt), a = 1.0 - e;
          // (the source linear in the optical depth across the part: the far end's share)
          vec4 fl = mix(a / max(dt, vec4(1e-9)) - e, dt * (0.5 - dt / 3.0), step(dt, vec4(1e-3)));
          I[q] += Tr[q] * (sA * a + dS * fl);
          Tr[q] *= e;
        }
      }
    }
    tP = tm; kP = k; sP = g.y; uP = g.z; wP = g.w;
    t += ds;
  }
  ${result}
}`;
  const FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCam;
uniform mat3 uBasis;
uniform float uTanHalf;
uniform float uRSnow;
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
uniform float uMS;      // multiple scattering, approximate (on by default, a toggle; see MS_C), as it fades in or out
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
uniform float uMag;      // the star's magnetosphere (see magLayer): 1 within 1 au of the star, fading out by MAG.SHOW
uniform float uStarK;    // 1 over the automatic exposure's factor: the star and the magnetosphere keep their light (see AE in the script)
uniform vec3 uMagAxis;   // the dipole's axis now: tilted by MAG.TILT toward the azimuth the star has turned to
uniform vec3 uMagE1;     // the zero of the magnetic azimuth: toward the tilt, perpendicular to the axis
uniform float uMagT;     // the model's clock (modulo 600 s), for the columns' fluctuations
// The cutaway: the part of space toward the camera between two vertical planes through the star (containing the
// axis) is cut away, and the cut faces show a quantity in false colour (uSliceQ: 0 none, only the cut, 1 temperature,
// 2 gas density, 3 optical depth toward the star). One plane faces the camera (its normal the camera's horizontal
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
uniform float uPuffT;   // the wind's puffs (see puffFactor): their clock, the model's (s, modulo 1000 periods)
uniform float uPuff;    // and their strength: 1 in the model's look (fading in with it), 0 in the observed ones
const vec3 WIND_COL = vec3(0.30, 0.56, 1.0);  // blue: small grains scatter blue light more strongly
const float PILE = 0.5;                 // extra glow of the ice pile-up beyond its surface density
const vec3 EXT = vec3(0.90, 0.97, 1.08); // small grains absorb blue light more strongly
const vec3 STARCOL = vec3(1.0, 0.87, 0.72);
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
const float ENV_RHO = 1.07e-4, G_ENV = 70.0, ENV_KSTAR = 0.133;   // (the map's column is in au, so both scale as 1 / r_c: 8 au to the sixth round, 30 au since)
const vec3 ENV_COL = vec3(0.55, 0.66, 0.95);
const int ENV_N = 40;                   // samples of the envelope in front of and behind the marched cylinder
void envLight(vec3 p, vec3 rd, out vec3 em, out vec3 ex){
  float r = max(length(p), 0.5), R = length(p.xy), lr = (log(r) - LNE_MIN) / LNE_SPAN, th = atan(p.z, R);
  float m = texture(uEnvMap, vec2(lr, abs(th) / (0.5 * PI))).r;
  vec2 st = texture(uEnv3, vec3(lr, atan(p.y, p.x) / TAU + 0.5, th / PI + 0.5)).rg;   // the streamers: density factor, column
  float re = ENV_RHO * uEnv * exp(m) * st.x;
  em = G_ENV * K_G * re * smoothstep(0.13, 0.2, abs(p.z) / max(R, 1e-3)) * exp(-ENV_KSTAR * st.y) / (1.0 + r * r / 3164.0) * phaseGas(dot(p, -rd) / r) * ENV_COL;
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
float Eabs(float R, float lnR, float H){
  float cut = cutOut(R), a = max(LNTAU1 - 1.25 * lnR - cut, 1.0);
  float beta = max(H * sqrt(2.0 * a) / R * (0.25 - (0.625 + 0.5 * P_OUT * cut) / a), 0.0) + 0.004 / R;
  return beta / 0.022 * pow(1.0 + R, 0.9) / (0.66 * (R * R + 0.01)) * smoothstep(R_IN * 0.85, R_IN * 1.5, R) * pow(max(R / OUTER_R, 1.0), OUTER_E);
}

// Temperature palette (linear RGB; the stops are chosen in display space): blue below the water-ice
// temperature, pale at it, then amber, gold and warm white toward dust sublimation. Hue carries
// temperature; brightness comes from the energy budget.
vec3 tcolor(float T){
  float l = log(T);
  vec3 c = vec3(0.023, 0.148, 0.893);                                     // 40 K
  c = mix(c, vec3(0.071, 0.325, 1.000), smoothstep(3.69, 4.50, l));      // 90 K
  c = mix(c, vec3(0.485, 0.755, 1.000), smoothstep(4.50, 4.98, l));      // 145 K
  c = mix(c, vec3(1.000, 0.852, 0.612), smoothstep(4.98, 5.16, l));      // 175 K
  c = mix(c, vec3(1.000, 0.325, 0.047), smoothstep(5.16, 5.86, l));      // 350 K
  c = mix(c, vec3(1.000, 0.682, 0.302), smoothstep(5.86, 6.68, l));      // 800 K
  c = mix(c, vec3(1.000, 0.914, 0.793), smoothstep(6.68, 7.38, l));      // 1600 K
  return c;
}

vec2 boundsCyl(vec3 ro, vec3 rd){
  float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - RB * RB;
  float t0 = -1e9, t1 = 1e9;
  if (a > 1e-6) { float d = b * b - a * c; if (d < 0.0) return vec2(1.0, 0.0); float s = sqrt(d); t0 = (-b - s) / a; t1 = (-b + s) / a; }
  else if (c > 0.0) return vec2(1.0, 0.0);
  if (abs(rd.z) > 1e-6) { float ta = (-ZB - ro.z) / rd.z, tb = (ZB - ro.z) / rd.z; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (abs(ro.z) > ZB) return vec2(1.0, 0.0);
  return vec2(max(t0, 0.0), t1);
}

// Behind the inner rim of the planet's gap the ray toward the star crosses the rim's surface layers, so tau* there is
// at least that of the rim at the same angle above the midplane (the starlight below the rim's surface is absorbed at
// the rim): ln tau* = max(local, rim). uGapRim: the rim's radius and its angle z/R seen from the star, the radius
// where the outer wall comes out of its shadow, and H/R at the rim (a radius of 1e9 when the gap is too shallow to
// cast a shadow). Ray tracing the same gas puts the surface (tau* = 1) across the gap within 3% of this angle. The wind's
// light and the slice take it.
uniform vec4 uGapRim;
float xRim(float R, float az, float x){
  if (R <= uGapRim.x) return x;
  float th = az / R, xr = 0.5 * (uGapRim.y * uGapRim.y - th * th) / (uGapRim.w * uGapRim.w);
  return mix(x, max(x, xr), 1.0 - smoothstep(uGapRim.z, uGapRim.z + 0.5, R));
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
// (round 12: quieter, the least that still shows the flow: half the contrast, PUFF_A 10 to 5, and 2 launches in 10,
// PUFF_SHARE 0.3 to 0.2)
const float PUFF_P = ${G(PUFF.P)}, PUFF_DUTY = 0.25, PUFF_A = 5.0, PUFF_KEEP = 0.3, PUFF_TAU = 30.0, PUFF_SHARE = 0.2;
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
float accColumn(float z0, float z1, float za, float ds, float dzh){
  float u1 = (z1 - za) / ACC_W;
  if (abs(dzh) < 0.05 * ACC_W) return exp(-0.5 * u1 * u1) * ds;
  float u0 = (z0 - za) / ACC_W;
  return ds / abs(dzh) * ACC_W * 1.2533141 * abs(erfA(u1 * 0.70710678) - erfA(u0 * 0.70710678));
}
#ifdef FULL
// the cutaway (the quantity 'none'): along the rays that pass through the part cut away, the gas behind the cut is drawn
// thinner (set per ray in main; see sampleDisk); the part left whole (the 1/4 cut's left half) keeps its look
float gThin = 1.0;
#endif
// One step of the ray march, from the previous sample (with ln τ* = xPrev) to p over a length ds.
// Returns emission and extinction per unit length for the gas and the wind, and the emission of the
// irradiated skin integrated over the step (it is far thinner than a step, so it is integrated
// analytically through the profile of absorbed starlight).
void sampleDisk(vec3 p, vec3 rd, float xPrev, float ds, inout vec3 wq, out vec3 em, out vec3 ex, out vec3 skin, out float x, out float wl){
  em = vec3(0.0); ex = vec3(0.0); skin = vec3(0.0); wl = 0.0;
  float R = max(length(p.xy), 1e-3), lnR = log(R);
  float H = H0 * exp(1.25 * lnR);
  float z = p.z, az = abs(z), zh = z / H;
  float gl = gapLn(R), cut = cutOut(R);
  x = clamp(LNTAU1 - 1.25 * lnR - cut + gl - 0.5 * zh * zh, -30.0, 30.0);
  if (R < R_IN * 0.7) { wq = vec3(99.0); return; }

  vec2 ed = vec2(1.0, 0.0);   // the eddies here: density factor, extra optical depth toward the star (relative)
  if (max(x, xPrev) > -14.0) {
    float phi = atan(p.y, p.x);
    float Tm = TICE * sqrt(uRSnow / R), Ts = 2.8 * Tm;
    vec4 dm = diskMap(lnR, phi);
    ed = eddies(lnR, phi, zh);
    float E = Eabs(R, lnR, H) * dm.a;
    // the irradiated skin: absorbed starlight j = E |d e^-τ* / dz|, integrated exactly for x varying
    // linearly over the step. The surface is corrugated by the turbulence; slopes facing the star
    // catch more light, and crests cast shadows (both in the disk map). The eddies do the same in three dimensions:
    // a denser eddy absorbs more of the light that reaches it (j ∝ ρ e^-τ*), and shades what lies behind it.
    bool atSkin = max(x, xPrev) > -4.5 && min(x, xPrev) < (uMS > 0.0 ? 6.0 : 2.2);
    if (atSkin && (uMode & 2) != 0) {
      float dx = x - xPrev, xm = 0.5 * (x + xPrev);
      float P = abs(dx) > 1e-3 ? (exp(-exp(xPrev)) - exp(-exp(x))) / dx : exp(xm - exp(xm));
      // seen by scattered starlight (near-isotropic grains); the colour stays that of the temperature
      float mu = dot(p, -rd) / max(length(p), 1e-3), base0 = G_SKIN * E * az / (H * H) * ds * dm.g * ed.x, base = base0 * P * exp(-ed.y);
      skin = base * phaseDisk(mu) * tcolor(Ts);
      float Pd = 0.0;   // multiple scattering: the diffuse light absorbed over the step (see MS_C)
      if (uMS > 0.0) {
        Pd = abs(dx) > 1e-3 ? (exp(-MS_C * exp(xPrev)) - exp(-MS_C * exp(x))) / dx : MS_C * exp(xm - MS_C * exp(xm));
        Pd *= uMS * MS_A * base0 * exp(-0.5 * ed.y);
        skin += Pd * tcolor(mix(Ts, Tm, smoothstep(0.5, 2.5, xm)));
      }
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
    // in the cutaway (the quantity 'none') the gas behind the cut is drawn four times thinner, its glow and its extinction
    // alike, so that the eye sees past the cut into the volume behind it (the depth, the inner disk's warm core, the far
    // layers) instead of the glow of the first stretch behind the face; only along the rays through the part cut away
    // (gThin), so that what is left whole keeps its look
    float thin = 1.0;
#ifdef FULL
    thin = gThin;
#endif
    ex = thin * K_G * rho * EXT * uComp.x;   // (the gas's absorption goes with the gas)
    // (beyond OUTER_R the glow is raised as the column thins, by R / OUTER_R, a picture of where the gas is)
    if ((uMode & 1) != 0) em = thin * G_GAS * K_G * rho * tcolor(Tm) * uComp.x * max(R / OUTER_R, 1.0);
    // the surface accretion layer(s) (see ACC): a column ACC_SIG of the local surface density, in its streaks, across a
    // Gaussian in height ACC_W H wide. The layer is thinner than a step, so its column over the step is integrated
    // across that profile (the height changes by rd.z ds over the step) and spread over the step as a mean density.
    // Drawn in the model's look only, with the gas (uMode & 1).
    float aa = accAmp(R) * float(uMode & 1) * uComp.x;
#ifdef FULL
    if (uLook != 0) aa = 0.0;
#endif
    if (aa > 0.0) {
      float za = zKinkH(R) + ACC_OFF, dzh = rd.z * ds / H, z0 = zh - dzh;
      vec2 col = vec2(accColumn(z0, zh, za, ds, dzh), accColumn(z0, zh, -za, ds, dzh)) * uAcc;
      if (col.x + col.y > 1e-4) {
        vec2 st = texture(uAccMap, vec2((lnR - LNR_MIN) / LNR_SPAN, phi / TAU + 0.5)).rg;
        float rA = thin * aa * ACC_SIG * rho0 / ACC_W * dot(col, st) / ds;   // (rho0 = Σ / sqrt(2π) H)
        ex += K_G * rA * EXT;
        em += G_ACC * K_G * rA * ACC_COL;
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
#ifdef FULL
  windOn = uLook <= 1;   // the wind and the envelope scatter starlight; no thermal emission is drawn for them
#endif
  if (x < 2.5 && windOn && (uMode & 8) != 0) {
    vec4 w = windMap(R, z);             // ln r0, azimuth relative to the foot, travel time, ln density
    // the grains that scatter and absorb: none where the gas left the disk inside about 2.5 R_IN (sublimated)
    float r0w = exp(w.x), r = length(p), rho = exp(w.w) * gapFactor(r0w) * (z > 0.0 ? 1.0 : uWindLow) * smoothstep(R_IN, 2.5 * R_IN, r0w);
    float gw = G_WIND, rise = WIND_RISE;
#ifdef FULL
    if (uLook != 0) { gw = G_WIND_OBS; rise = 0.0; }
#endif
    float lit = gw * mix(WIND_NEAR, 1.0, smoothstep(22.0, 68.0, length(uCam))) * K_G * rho / (1.0 + r * r / 225.0)
              * phaseGas(dot(p, -rd) / max(r, 1e-3)) * exp(-exp(xRim(R, az, x)) * (1.0 + ed.y))
              * exp(-rise * min(w.w - log(RHO_B) + 1.5 * w.x, 0.0));   // (rho / rho_base)^-WIND_RISE, see G_WIND
    wl = lit;
    if (lit > 2e-4) {
      // the foot of the line, now at azimuth phi - w.y, has turned by w.z since this gas left it
      q = vec3(w.x, atan(p.y, p.x) - w.y - w.z, w.z);
      vec3 d = q - wq; d.y = mod(d.y + PI, TAU) - PI;
      float st = windTurb(q, wq.x > 50.0 ? vec3(0.0) : abs(d), w.w - log(RHO_B) + 1.5 * w.x, length(p - uCam) / max(r, 0.1));
      if ((uMode & 8) != 0) em += lit * st * WIND_COL * uComp.w;
      ex += K_G * rho * st * EXT * uComp.w;   // (and the wind's with the wind)
    }
  }
  wq = q;
#ifdef FULL
  // the envelope, where it reaches into the marched cylinder (lit unless in the disk's shadow)
  if (uEnv > 0.0 && uLook <= 1) { vec3 e1, e2; envLight(p, rd, e1, e2); em += e1; ex += e2; }
#endif
}
// The envelope outside the cylinder, marched in ENV_N steps from t0 to t1 (it is smooth): beyond the disk the
// starlight is blocked within the angle of the disk's surface seen from the star (z/R below about 0.16)
void envMarch(vec3 ro, vec3 rd, float t0, float t1, float jitter, vec2 skip, inout vec3 col, inout vec3 tr){
  if (t1 <= t0) return;
  float ds = (t1 - t0) / float(ENV_N);
  for (int i = 0; i < ENV_N; i++) {
    float t = t0 + (float(i) + jitter) * ds;
    if (t > skip.x && t < skip.y) continue;   // (in the part cut away)
    vec3 em, ex; envLight(ro + rd * t, rd, em, ex);
    vec3 a = exp(-ex * ds);
    col += tr * em * (1.0 - a) / max(ex, vec3(1e-9));
    tr *= a;
  }
}
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
  float Tm = TICE * sqrt(uRSnow / R);
  float ice = 1.0 - smoothstep(TICE - 6.0, TICE + 6.0, Tm);
  float pile = 1.0 + 1.2 * ice * exp(-pow((R - 1.15 * uRSnow) / (0.13 * uRSnow), 2.0));
  // with the planet, pebbles are filtered out of the gap (deeper and a little wider than in the gas) and collect
  // at the pressure maximum just outside it, a bright ring, once the gap is deep enough to make one (uTrap)
  // (none inside the planet's Hill sphere, where its own disk is)
  float xg = (R - A_P) / (1.15 * GAP_W), xt = (R - uTrap.x) / (0.28 * GAP_W);
  float trap = (1.0 - uTrap.y * exp(-xg * xg)) * (1.0 + 2.2 * uTrap.z * exp(-xt * xt)) / gapFactor(R);
#ifdef FULL
  if (uPlanetVis > 0.0) trap *= smoothstep(1.5 * R_CPD, 2.5 * R_CPD, length(p - uPlanetPos));
#endif
  vec4 dm = diskMap(lnR, phi);
  float sd = ${G(MODEL.SD0)} * Sigma(R, lnR) * trap * pile * (0.5 + 0.5 * ice) * dm.b, sc = 0.0;
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
    if (uLook == 3) { float tm = K_MM * sd / max(mu, 0.15); col += tr * G_MM * (Tm / 100.0) * (1.0 - exp(-tm)) * MM_COL; tr *= exp(-tm); }
    else if (uLook == 4) tr *= exp(-K_MM * sd / max(mu, 0.15));
    else tr *= exp(-K_D * sd / max(mu, 0.03));
    return;
  }
#endif
  float tau = K_D * sd / max(mu, 0.03);
  float tmm = K_MM * sd / max(mu, 0.3);
  vec3 alb = mix(vec3(0.42, 0.20, 0.10) * 0.25, 0.9 * tcolor(min(Tm, 120.0)), ice);
  alb = mix(alb, vec3(0.85, 0.92, 1.0) * mix(0.35, 1.0, ice), sc / (sd + 1e-6));   // packed pebbles look paler
  vec3 src = G_DUST * alb * Eabs(R, lnR, H) * dm.a * (1.0 - exp(-tmm)) * (1.0 + PILE * (pile - 1.0));
  col += tr * src;
  tr *= exp(-tau);
}

// sparse faint stars, fixed on the sky, at a density per CSS pixel so small panels are not crowded
vec3 stars(vec3 rd, float pixA){
  float cs = 11.0 * uPx * pixA;
  vec3 cell = floor(rd / cs);
  float h = hash13(cell + 0.37 * uSeed);
  if (h < 0.985) return vec3(0.0);
  vec3 o = vec3(hash13(cell + 1.3), hash13(cell + 2.9), hash13(cell + 4.1));
  vec3 sdir = normalize((cell + 0.2 + 0.6 * o) * cs);
  float sig = 0.55 * uPx * pixA;
  float d2 = dot(rd - sdir, rd - sdir) / (sig * sig);
  float b = pow((h - 0.985) / 0.015, 3.0) * 0.06 + 0.004;
  return mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.75), o.x) * b * exp(-0.5 * d2);
}

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
// three nested clouds (widths in units of the disk's radius, 0.4 Hill radii; thickness 0.15 of the width, a flared disk),
// with their vertical optical depths and their glow, hotter inside (heated by accretion onto the planet)
vec4 planetLight(vec3 ro, vec3 rd, float aspect){
  vec3 q = ro - uPlanetPos;
  float t1 = 0.5 * cloud(q, rd, 0.12 * R_CPD, 0.016 * R_CPD), t2 = 0.6 * cloud(q, rd, 0.3 * R_CPD, 0.045 * R_CPD), t3 = 0.5 * cloud(q, rd, 0.55 * R_CPD, 0.09 * R_CPD);
  float tt = t1 + t2 + t3;
  vec3 em = (t1 * 2.2 * tcolor(1000.0) + t2 * 0.7 * tcolor(400.0) + t3 * 0.22 * tcolor(190.0)) / max(tt, 1e-6) * (1.0 - exp(-tt));
  // the planet, a point (its radius, 1.5 Jupiter radii, is below a pixel unless the camera is within about 0.3 au)
  vec3 pv = vec3(dot(-q, uBasis[0]), dot(-q, uBasis[1]), dot(-q, uBasis[2]));
  if (pv.z > 0.0) {
    vec2 ppx = (vec2(pv.x / (pv.z * uTanHalf * aspect), pv.y / (pv.z * uTanHalf)) * 0.5 + 0.5) * uRes;
    float d = length(gl_FragCoord.xy - ppx) / uPx, rp = 0.0007 / (pv.z * 2.0 * uTanHalf / uRes.y) / uPx;   // CSS px
    em += tcolor(1300.0) * (4.0 * exp(-max(d - rp, 0.0) * max(d - rp, 0.0) / 0.8) + 0.1 * exp(-d / 2.5)) * exp(-0.25 * tt);
  }
  return vec4(em, tt) * uPlanetVis;
}

// Quantities on the cut face at the point Rs (signed, along uSliceR) and z of the plane, with phi its azimuth:
// the temperature of the two layers (the interior at T_mid, above the irradiation surface at T_s = 2.8
// T_mid), log10 of the gas density (the disk with its turbulence, plus the wind) relative to the midplane
// at 1 au, and ln tau* toward the star (the smooth disk, as for the irradiation). The same expressions as
// the volume uses.
const float LN10 = 2.302585;
const float ENV_R = ${G(ENV.R)};
vec3 sliceQuantities(float Rs, float z, float phi){
  float R = max(abs(Rs), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR), zh = z / H;
  float x = clamp(xRim(R, abs(z), LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R) - 0.5 * zh * zh), -30.0, 30.0);
  float Tm = TICE * sqrt(uRSnow / R);
  vec4 w = windMap(R, z);
  // (close to the star, uMag, the gas disk reaches the magnetosphere's edge, inside the dust's: see MAG)
  float gasIn = uMag * max(smoothstep(MAG_RT * 0.95, MAG_RT * 1.08, R) - smoothstep(R_IN * 0.8, R_IN * 1.3, R), 0.0);
  float rho = (Sigma(R, lnR) + gasIn * exp(-lnR - cutOut(R))) / (2.5066 * H) * exp(-0.5 * zh * zh) * diskMap(lnR, phi).r * eddies(lnR, phi, zh).x
            + exp(w.w + gapLn(exp(w.x))) * (z > 0.0 ? 1.0 : uWindLow);
  return vec3(x > 0.0 ? Tm : 2.8 * Tm, log(max(rho, 1e-30) * ${G(Math.sqrt(2 * Math.PI) * MODEL.H0)}) / LN10, x);
}
// The stretch (tIn, tOut) of the ray in the part cut away (empty when tIn >= tOut): the intersection of the two
// half-spaces dot(p, n_i) > uSliceOff, so a single stretch, as the part is convex.
vec2 cutSpan(vec3 ro, vec3 rd){
  float ca = cos(2.0 * uCutA), sa = sin(2.0 * uCutA), lo = -1e9, hi = 1e9;
  for (int i = 0; i < 2; i++) {
    vec3 n = i == 0 ? ca * uSliceN + sa * uSliceR : uSliceN;
    float s0 = dot(ro, n) - uSliceOff, sv = dot(rd, n);
    if (abs(sv) < 1e-7) { if (s0 <= 0.0) return vec2(1e9, -1e9); }
    else if (sv > 0.0) lo = max(lo, -s0 / sv);
    else hi = min(hi, -s0 / sv);
  }
  return vec2(lo, hi);
}
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
// The layers of the coupling (quantity 4; see NONIDEAL and ACC), as regions in flat colours: below the wind's base (the
// irradiation surface, tau* = 1) the turbulent, thermally ionized inner disk, the dead zone (below z_k), the laminar
// surface above it and the accretion layer(s) in it (within 1.2 ACC_W of their centres, on the side(s) that accrete);
// above the base the wind, translucent, fading with its density. The disk's edge ends the face as the temperature's does.
const vec3 LAY_MRI = vec3(0.88, 0.47, 0.27), LAY_DEAD = vec3(0.15, 0.19, 0.34), LAY_SURF = vec3(0.44, 0.58, 0.76), LAY_ACC = vec3(1.0, 0.71, 0.28), LAY_WIND = vec3(0.64, 0.85, 0.95);
// Close to the star (uMag), the magnetosphere's regions (see MAG) at p3 (alpha 0 elsewhere): the star, the region of the
// closed lines inside the disk's inner edge (no disk there: the cavity), the curtains' cross-section (the lines L =
// MAG_RT to MAG_RT (1 + MAG_DL) where the gas falls, where a curtain is denser than 0.3 of its middle, as in magColumn)
// and (gas) the dust-free gas disk between the magnetosphere's edge and the dust's (within 2 H of the midplane); inside
// the dust's edge nothing else (the face is open there, as from afar). On every quantity's face, so that the curtains
// are not taken for the disk's own flows: labelled in the overlay.
const vec3 LAY_MAG = vec3(0.60, 0.48, 0.86), LAY_STREAM = vec3(1.0, 0.36, 0.50), LAY_GAS = vec3(0.98, 0.64, 0.52);
vec4 magFace(float R, float z, vec3 p3, bool gas){
  float r = length(p3), cz = dot(p3, uMagAxis) / max(r, 1e-6), L = r / max(1.0 - cz * cz, 1e-5), u = (L / MAG_RT - 1.0) / MAG_DL;
  if (r < MAG_RS) return vec4(pow(STARCOL, vec3(1.0 / 2.2)), 1.0);
  if (u < 0.0) return vec4(LAY_MAG, 0.6);
  float phm = atan(dot(p3, cross(uMagAxis, uMagE1)), dot(p3, uMagE1)), dph = cz > 0.0 ? phm : PI - abs(phm);
  if (u < 1.0 && magAz(dph) * smoothstep(0.08, 0.3, abs(cz)) > 0.3) return vec4(LAY_STREAM, 0.9);
  if (gas && R > MAG_RT && R < R_IN * 1.05 && abs(z) < 2.0 * H0 * pow(R, 1.25)) return vec4(LAY_GAS, 1.0);
  return vec4(0.0);
}
vec4 layersFace(float R, float z, vec3 q){
  float H = H0 * pow(R, 1.25), zh = abs(z) / H, zb = zBase(R) / H, zk = zKinkH(R);
  if (zh > zb || q.z < -4.0) return vec4(LAY_WIND, 0.5 * smoothstep(-8.0, -5.0, q.y));
  vec3 c = zh < zk ? LAY_DEAD : LAY_SURF;
  if (mriAmp(R) > 0.5) c = LAY_MRI;
  if (abs(zh - zk - ACC_OFF) < 1.2 * ACC_W && (z > 0.0 ? uAcc.x : uAcc.y) * accAmp(R) > 0.5) c = LAY_ACC;
  return vec4(c, 1.0);
}
// The cut face at pc: the colour (display values) and its opacity. The temperature is shown in the colours
// the volume uses for it, over the disk and its irradiated surface layer (up to tau* of about 0.01); the
// density (log10, from 10^-10 to 10^2.5 of the midplane at 1 au) over the disk and the wind; the optical
// depth (log10 tau* from -4 to 5) over the disk. The dust-free hole inside R_IN stays open.
vec4 sliceFace(vec3 pc){
  float R = length(pc.xy), z = pc.z / uSliceZ;   // the plane may be off the star while it sweeps
  vec3 q = sliceQuantities(R, z, atan(pc.y, pc.x));
  float hole = smoothstep(R_IN * 0.8, R_IN * 1.3, R), holeG = max(hole, uMag * smoothstep(MAG_RT * 0.95, MAG_RT * 1.08, R));   // (the gas's, close up)
  // (close to the star the magnetosphere's regions, on every face: the gas disk inside the dust's edge keeps its
  // quantity, on the layers' face its colour)
  vec4 m = uSliceQ > 0 && uMag > 0.0 && R < R_IN * 1.05 ? magFace(R, z, vec3(pc.xy, z), uSliceQ == 4) * vec4(1.0, 1.0, 1.0, uMag) : vec4(0.0);
  if (m.a > 0.0) return m;
  if (uSliceQ == 1) return vec4(0.92 * pow(tcolor(q.x), vec3(1.0 / 2.2)), smoothstep(-6.0, -4.5, q.z) * holeG);
  if (uSliceQ == 2) return vec4(cmap((q.y + 10.0) / 12.5, false), smoothstep(-10.5, -9.5, q.y));
  if (uSliceQ == 3) return vec4(cmap((q.z / LN10 + 4.0) / 9.0, true), smoothstep(-4.5, -3.5, q.z / LN10) * hole);
  if (uSliceQ == 4) return layersFace(R, z, q) * vec4(1.0, 1.0, 1.0, hole);
  return vec4(0.0);
}

#ifdef FULL
// ---- The CO line (uLook 4): a rotational line of carbon monoxide at millimetre wavelengths, as a channel map or as
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
float gapSlope(float R){
  if (uPlanet <= 0.0) return 0.0;
  float x = (R - A_P) / GAP_W;
  if (abs(x) > 3.5) return 0.0;
  float e = exp(-x * x);
  return R * 2.0 * uPlanet * x * e / (GAP_W * (1.0 - uPlanet * e));
}
// the gas at p for the CO line: CO density (relative), temperature (K), velocity along rd (km/s), line width (km/s:
// thermal and turbulent, sigma^2 = (0.025 sqrt(T))^2 + 0.011)
vec4 coGas(vec3 p, vec3 rd){
  float R = max(length(p.xy), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR), zh = p.z / H, az = abs(p.z);
  float cut = cutOut(R), gl = gapLn(R), phi = atan(p.y, p.x);
  float x = clamp(LNTAU1 - 1.25 * lnR - cut + gl - 0.5 * zh * zh, -30.0, 30.0);
  vec4 dm = diskMap(lnR, phi);
  // (the gas disk reaches the magnetosphere's edge MAG_RT, inside the dust's)
  float rhoD = exp(-lnR - cut + gl - 0.5 * zh * zh) * smoothstep(MAG_RT * 0.95, MAG_RT * 1.08, R) / (2.5066 * H) * dm.r * eddies(lnR, phi, zh).x;
  vec4 w = windMap(R, p.z);
  float r0w = exp(w.x), rhoW = exp(w.w) * gapFactor(r0w) * (p.z > 0.0 ? 1.0 : uWindLow) * smoothstep(R_IN, 2.5 * R_IN, r0w);
  float Tm = TICE * sqrt(uRSnow / R), Ts = 2.8 * Tm, Td = mix(Ts, Tm, smoothstep(0.5, 2.5, x));
  vec2 er = vec2(cos(phi), sin(phi)), ep = vec2(-er.y, er.x);
  float vk = 29.78 * inversesqrt(R), h = H / R, cs = h * vk;
  // the disk: Keplerian at height z, (R/r)^3/2, with the pressure gradient (d ln P / d ln R = d ln Σ / d ln R - 7/4)
  float vphi = vk * pow(1.0 + zh * zh * h * h, -0.75) * (1.0 + 0.5 * h * h * (-1.0 - P_OUT * cut + gapSlope(R) - 1.75));
  // the planet's wake pushes the gas outward with its density excess (beyond the turbulent inner disk, where the disk
  // map's gas factor is the wake's); the accretion layer(s) flow inward
  float vR = R > 0.6 ? 0.5 * cs * (dm.r - 1.0) : 0.0;
  float za = zKinkH(R) + ACC_OFF, zu = (zh - za) / ACC_W, zl = (zh + za) / ACC_W;
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
  float qE = length(vec2(R / RB, p.z / ZB));
  float rD = rhoD * uComp.x * smoothstep(CO_SH.y, CO_SH.x, log(max(rhoD, 1e-30)));
  float rW = CO_WIND * rhoW * uComp.w * smoothstep(CO_SH.y, CO_SH.x, log(max(rhoW, 1e-30)));
  float rhoCO = (rD + rW) * (1.0 - smoothstep(0.75, 0.98, qE)), T = Td;
  if (rW > 1e-3 * rD) {
    vec4 wv = texture(uWindVel, vec2((0.5 * log(R * R + az * az) - LNW_MIN) / LNW_SPAN, 0.5 + atan(p.z, R) / PI));
    float vk0 = 29.78 * inversesqrt(r0w);
    vec3 vw = vec3((wv.x * er + wv.y * ep) * vk0, sign(p.z) * wv.z * vk0);
    float rS = max(rD + rW, 1e-30);
    v = (rD * v + rW * vw) / rS;
    T = (rD * Td + rW * Ts) / rS;
  }
  return vec4(rhoCO, T, dot(v, rd), sqrt(0.000625 * T + 0.011));
}
// the channel map's intensity at velocity v: averaged over a channel 0.25 km/s wide (four velocities)
${CO_MARCH_GLSL('coChannel', 1, 'float', 'float v', 'v + vec4(-0.09375, -0.03125, 0.03125, 0.09375)', 'return dot(I[0], vec4(0.25));')}
// moments 0 and 1 from CO_N velocities spread evenly over the window wv (see coWindow), as an observer sums a cube: the
// channels summed times their width, and their intensity-weighted mean velocity
${CO_MARCH_GLSL('coMoments', 'CO_Q', 'vec2', 'vec2 wv', '(wv.x + (wv.y - wv.x) / float(4 * CO_Q) * (4.0 * float(q) + vec4(0.5, 1.5, 2.5, 3.5)))',
  'float m0 = 0.0, mv = 0.0; for (int q = 0; q < CO_Q; q++) { m0 += dot(I[q], vec4(1.0)); mv += dot(I[q], wv.x + (wv.y - wv.x) / float(4 * CO_Q) * (4.0 * float(q) + vec4(0.5, 1.5, 2.5, 3.5))); } return vec2(m0 * (wv.y - wv.x) / float(4 * CO_Q), m0 > 0.0 ? mv / m0 : 0.0);')}
// the velocities the moments need along a ray: those of its gas with line opacity in front of the opaque pebble sheet,
// from a march three times as coarse, widened by 6.5 line widths (and a little for what the coarse march may miss)
vec2 coWindow(vec3 ro, vec3 rd, vec2 b, float tCross){
  float t = b.x, lo = 1e9, hi = -1e9, w = 0.0;
  bool sheetDone = tCross <= b.x || tCross >= b.y;
  for (int i = 0; i < 110; i++) {
    if (3 * i >= uSteps || t > b.y) break;
    vec3 p = ro + rd * t;
    float R = max(length(p.xy), 0.05), Hs = H0 * pow(R, 1.25), az = abs(p.z);
    float ds = 3.0 * clamp(max(0.4 * Hs, (az > 4.5 * Hs ? 0.25 : 0.18) * az), 0.004, max(0.4, 0.05 * length(p)));
    vec3 pm = ro + rd * (t + 0.5 * ds);
    vec4 g = coGas(pm, rd);
    if (K_CO * g.x * ds > 1e-3 && length(pm.xy) > MAG_RT * 0.9) { lo = min(lo, g.z); hi = max(hi, g.z); w = max(w, g.w); }
    if (!sheetDone && t + ds >= tCross) {
      vec3 c0 = vec3(0.0), tr0 = vec3(1.0);
      sheet(ro + rd * tCross, rd, c0, tr0);
      sheetDone = true;
      if (tr0.r < 0.01) break;
    }
    t += ds;
  }
  if (lo > hi) return vec2(0.0, -1.0);
  float m = 6.5 * w + 0.1 + 0.03 * max(abs(lo), abs(hi));
  return vec2(lo - m, hi + m);
}
// the CO line along a ray within the marched cylinder (b): (the channel's intensity in K, or moment 0 in K km/s and
// moment 1 in km/s, 0, 1)
vec4 coLinear(vec3 ro, vec3 rd, vec2 b, float tCross, float jitter){
  if (uCoMode == 0) return vec4(coChannel(ro, rd, b, tCross, jitter, uCoV), 0.0, 0.0, 1.0);
  vec2 wv = coWindow(ro, rd, b, tCross);
  if (wv.y <= wv.x) return vec4(0.0, 0.0, 0.0, 1.0);
  return vec4(coMoments(ro, rd, b, tCross, jitter, wv), 0.0, 1.0);
}
// the CO picture for a ray within the marched cylinder, in display values
vec3 coPicture(vec3 ro, vec3 rd, vec2 b, float tCross, float jitter){
  vec4 q = coLinear(ro, rd, b, tCross, jitter);
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
const int MAG_N = 48;                   // steps through the magnetosphere's sphere (about 2.5 ms at 0.15 au, at the usual resolution)
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
  if (u <= 0.0) return u < -0.8 ? vec3(0.0) : CAV_COL * (MAG_CAVB * exp(u * MAG_DL / 0.06) * smoothstep(0.0, 0.15, abs(cz)) * smoothstep(MAG_RS, 1.5 * MAG_RS, r));   // (the closed region's edge)
  float phm = atan(dot(p, cross(uMagAxis, uMagE1)), dot(p, uMagE1)), dph = cz > 0.0 ? phm : PI - abs(phm);   // (from the curtain's middle)
  float w = magAz(dph) * sin(PI * u) * smoothstep(0.08, 0.3, abs(cz));   // (lifting off the disk near the magnetic equator)
  if (w < 1e-3) return vec3(0.0);
  float x = min(s2, 0.9999), vt = sqrt(2.0 * GM_V / L), v = vt * sqrt(1.0 / x - 1.0), vs = vt * sqrt(L / MAG_RS - 1.0);   // (x = r / L)
  float rho = sqrt(1.0 + 3.0 * cz * cz) / (x * x * x) * vs / max(v, 0.1 * vs);
  float tff = sqrt(L * L * L / (2.0 * GM_V)) * (sqrt(x * (1.0 - x)) + acos(sqrt(x)));
  float n = vnoise3(vec3(phm / TAU * MAG_CELLS.x, u * MAG_CELLS.y, (uMagT - tff) / MAG_PULSE), MAG_CELLS.x);
  return MAG_COL * (MAG_COLB * w * pow(rho / 500.0, 1.2) * exp(MAG_FL * n - 0.0171 * MAG_FL * MAG_FL));
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
  float a = smoothstep(MAG_RT * 0.97, MAG_RT * 1.05, R) * (1.0 - smoothstep(R_IN * 0.85, R_IN * 1.25, R));
  float wall = 1.0 + 2.5 * exp(-pow((R - MAG_RT * 1.04) / (0.05 * MAG_RT), 2.0));
  return a > 0.0 ? MAG_GASB * tcolor(1500.0) * a * wall / max(cosi, 0.05) : vec3(0.0);
}
// The magnetosphere laid in at the star's distance, as the star's light is (the disk in front dims it): the columns
// (optically thin; not in the part cut away), the gas disk inside the dust's edge where the ray crosses the midplane in
// front of the star, and the star's surface (whole, also with the cutaway), which hides what lies behind it. As it fades in (uMag) it takes over from
// the star's point-like glow.
// (colC: the light kept through the automatic exposure, added to col and also gathered there, so that the measurement
// leaves out the pixels it dominates)
void magLayer(vec3 ro, vec3 rd, float jitter, vec3 starGlow, float tCut, vec2 tSkip, inout vec3 col, inout vec3 tr, inout vec3 colC){
  if (uMag <= 0.0) { col += tr * starGlow; colC += tr * starGlow; return; }
  vec2 bs = boundsSphere(ro, rd, MAG_RS), bm = boundsSphere(ro, rd, MAG_R);
  bool hit = bs.y > bs.x;   // (the star is not cut away)
  vec3 em = vec3(0.0);
  if (bm.y > bm.x) {
    float t0 = max(bm.x, tCut), t1 = hit ? bs.x : bm.y, ds = (t1 - t0) / float(MAG_N);
    if (ds > 0.0) {
      for (int i = 0; i < MAG_N; i++) {
        float t = t0 + (float(i) + jitter) * ds;
        if (t > tSkip.x && t < tSkip.y) continue;
        em += magColumn(ro + rd * t);
      }
      em *= ds;
    }
  }
  float tz = abs(rd.z) > 1e-6 ? -ro.z / rd.z : -1.0;
  if (tz > tCut && (!hit || tz < bs.x) && !(tz > tSkip.x && tz < tSkip.y)) em += magGasDisk(length((ro + rd * tz).xy), abs(rd.z));
  vec3 surf = hit ? magSurface(normalize(ro + rd * bs.x), rd) * uStarK : vec3(0.0);
  if (uLook > 1) em = vec3(0.0);   // (the columns and the gas disk glow in the model's look and in scattered light only)
  vec3 kept = tr * (uMag * (em * uStarK + surf) + (hit ? 1.0 - uMag : 1.0) * starGlow);   // (uStarK: the magnetosphere keeps its own light through the automatic exposure)
  col += kept; colC += kept;
  if (hit) tr *= 1.0 - uMag;
}
#endif
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
vec4 faceAt(vec2 fc){
  vec2 uv = (fc / uRes) * 2.0 - 1.0;
  vec3 rd = normalize(uBasis[2] + uTanHalf * (uv.x * (uRes.x / uRes.y) * uBasis[0] + uv.y * uBasis[1]));
  vec2 cs = cutSpan(uCam, rd);
  if (uSlice == 0 || uSliceFace <= 0.0 || !(cs.x < cs.y && cs.x <= 0.0 && cs.y > 0.0 && cs.y < 1e8)) return vec4(0.0);
  vec4 f = sliceFace(uCam + rd * cs.y);
  float a = f.a * uSliceFace;
  return vec4(f.rgb * a, a);
}
#endif
void main(){
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
#endif
  vec2 uv = ((gl_FragCoord.xy + uJit.xy) / uRes) * 2.0 - 1.0, uv0 = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uBasis[2] + uTanHalf * (uv.x * aspect * uBasis[0] + uv.y * uBasis[1]));
  vec3 ro = uCam;
  float pixA = 2.0 * uTanHalf / uRes.y;   // angular size of a render pixel

  // background: deep gradient with sparse faint stars (kept at the pixels' centres, so they stay crisp in a refined still)
  vec3 sky = mix(vec3(0.0020, 0.0026, 0.0050), vec3(0.0040, 0.0056, 0.0130), smoothstep(-1.0, 1.0, uv0.y));
  vec3 bg = stars(normalize(uBasis[2] + uTanHalf * (uv0.x * aspect * uBasis[0] + uv0.y * uBasis[1])), pixA);

  // the star is a point: drawn with a small screen-space profile so it stays crisp at any size
  vec3 sv = vec3(dot(-ro, uBasis[0]), dot(-ro, uBasis[1]), dot(-ro, uBasis[2]));
  vec2 spx = (vec2(sv.x / (sv.z * uTanHalf * aspect), sv.y / (sv.z * uTanHalf)) * 0.5 + 0.5) * uRes;
  float dpx = length(gl_FragCoord.xy - spx) / uPx;
  vec3 starGlow = STARCOL * (40.0 * exp(-dpx * dpx / 1.2) + 0.4 * exp(-dpx / 2.0) + 0.02 / (1.0 + dpx * dpx / 50.0)) * uStar;
  float tStar = max(-dot(ro, rd), 0.0);

  // the cutaway: from a camera in the part cut away the ray enters the kept part at tCut, where it meets a cut face
  // (rays that never reach it see only the sky); the face hides what lies behind it where it is opaque. While the
  // planes sweep they may pass the camera: from inside the kept part nothing is cut in front, and a ray that crosses
  // the part cut away skips it (tSkip) or, when it leaves the kept part for good, ends there. The face itself is laid
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
        if (tCut < 1e8 && uSliceFace > 0.0) {
          face = sliceFace(ro + rd * tCut); face.a *= uSliceFace;
          // (opaque over the screen's pixels this one reaches when upsampled, a render pixel around, and one more screen
          // pixel, where the face's edge is smoothed: faceA at the corners of that square, which a straight edge across it
          // cannot all miss)
          if (face.a >= 0.999 && uFaceRdy != 0) {
            vec2 c = gl_FragCoord.xy * uFaceRes / uRes, sc = uFaceRes / uRes + 1.0;
            ivec2 mx = ivec2(uFaceRes) - 1;
            faceOpaque = min(min(texelFetch(uFaceA, clamp(ivec2(c - sc), ivec2(0), mx), 0).a, texelFetch(uFaceA, clamp(ivec2(c + vec2(sc.x, -sc.y)), ivec2(0), mx), 0).a),
                             min(texelFetch(uFaceA, clamp(ivec2(c + vec2(-sc.x, sc.y)), ivec2(0), mx), 0).a, texelFetch(uFaceA, clamp(ivec2(c + sc), ivec2(0), mx), 0).a)) >= 0.999;
          }
        }
      } else if (cs.y > 1e8) tEnd = cs.x;
      else tSkip = cs;
    }
    // (the cutaway's thinner gas, along the rays through the part cut away)
    if (uSliceQ == 0 && (tCut > 0.0 || tSkip.x < 1e8)) gThin = mix(1.0, 0.25, uSliceFace);
  }
#endif

  vec3 col = vec3(0.0), tr = vec3(1.0), colC = vec3(0.0);
  vec2 b = boundsCyl(ro, rd);
  b.x = max(b.x, tCut); b.y = min(b.y, tEnd);
  bool starDone = false;
#ifdef FULL
  // the planet and its disk, where the ray passes closest to it (1e9: not met, or done; their light is evaluated
  // only there, so that the march carries one number for them)
  float tPl = uPlanetVis > 0.0 ? dot(uPlanetPos - ro, rd) : 1e9;
  if (tPl <= tCut || (tPl > tSkip.x && tPl < tSkip.y)) tPl = 1e9;
#endif
  float tCross = abs(rd.z) > 1e-5 ? -ro.z / rd.z : -1.0;
  bool inside = b.y > b.x && !faceOpaque;
  float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y) + uJit.z);   // interleaved gradient noise: finer grain than a hash
#ifdef FULL
  if (uLook == 4) {
    // the CO picture over a dark sky, as dark as the other looks' (no stars: a map of the line)
    vec3 bgD = mix(vec3(0.035, 0.040, 0.062), vec3(0.047, 0.056, 0.096), smoothstep(-1.0, 1.0, uv0.y));
    fragColor = vec4(max(inside ? coPicture(ro, rd, b, tCross, jitter) : vec3(0.0), bgD), 1.0);
    return;
  }
#endif
#ifdef FULL
  // the envelope: the part of its sphere in front of the cylinder (all of it when the ray misses the cylinder)
  vec2 be = vec2(1.0, 0.0);
  if (uEnv > 0.0 && uLook <= 1 && !faceOpaque) {
    be = boundsSphere(ro, rd, ENV_R); be.x = max(be.x, tCut); be.y = min(be.y, tEnd);
    envMarch(ro, rd, be.x, inside ? min(b.x, be.y) : be.y, jitter, tSkip, col, tr);
  }
#endif
  // the midplane crossing may lie in the unlit outer disk, in front of or behind the marched part (or in
  // the half cut away)
  bool sheetDone = tCross <= tCut || tCross >= tEnd || (tCross > tSkip.x && tCross < tSkip.y) || faceOpaque;
  if (!sheetDone && (!inside || tCross < b.x)) { sheet(ro + rd * tCross, rd, col, tr); sheetDone = true; }
  if (inside) {
    float t = b.x;
    vec3 p = ro + rd * t;
    float xPrev = lnTauStar(p);
    vec3 wq = vec3(99.0);
    float wl = 0.0;   // the wind's brightness at the last sample
    for (int i = 0; i < 320; i++) {
      if (i >= uSteps || t > b.y || max(tr.r, max(tr.g, tr.b)) < 0.01) break;
      float R = length(p.xy);
      // steps follow the scale height in the disk and grow with height above it (only the wind is
      // there); beyond the lit region only the dust sheet matters, and it is crossed analytically
      float Hs = H0 * pow(max(R, 0.2), 1.25), az = abs(p.z);
      bool fine = wl > WIND_FINE;
      float rr = length(p);   // (the longest steps grow with the distance beyond 8 au, as the disk's structure does)
      float ds = clamp(max(0.4 * Hs, (az > 4.5 * Hs ? (fine ? WIND_DS : 0.25) : 0.18) * az), 0.004, fine ? max(WIND_DSMAX, 0.03 * rr) : max(0.4, 0.05 * rr));
      if (i == 0) ds *= 0.25 + jitter;
      float t1 = t + ds;
#ifdef FULL
      if (t1 > tSkip.x) { t = tSkip.y; p = ro + rd * t; xPrev = lnTauStar(p); wq = vec3(99.0); tSkip = vec2(1e9); continue; }   // across the part cut away
#endif
      if (!sheetDone && t1 >= tCross) { sheet(ro + rd * tCross, rd, col, tr); sheetDone = true; }
#ifdef FULL
      if (!starDone && t1 >= tStar) { magLayer(ro, rd, jitter, starGlow, tCut, tSkip, col, tr, colC); starDone = true; }
#else
      if (!starDone && t1 >= tStar) { col += tr * starGlow; colC += tr * starGlow; starDone = true; }
#endif
#ifdef FULL
      if (t1 >= tPl) { vec4 pl = planetLight(ro, rd, aspect); col += tr * pl.rgb; tr *= exp(-pl.a); tPl = 1e9; }
#endif
      p = ro + rd * t1;
      vec3 em, ex, sk; float x;
      sampleDisk(p, rd, xPrev, ds, wq, em, ex, sk, x, wl);
      col += tr * sk;
      vec3 a = exp(-ex * ds);
      col += tr * em * mix(vec3(ds), (1.0 - a) / max(ex, vec3(1e-6)), step(vec3(1e-5), ex * ds));
      tr *= a;
      xPrev = x; t = t1;
    }
  }
  if (!sheetDone) sheet(ro + rd * tCross, rd, col, tr);
#ifdef FULL
  if (!starDone && tCut < 1e8) magLayer(ro, rd, jitter, starGlow, tCut, tSkip, col, tr, colC);
#else
  if (!starDone && tCut < 1e8) { col += tr * starGlow; colC += tr * starGlow; }
#endif
#ifdef FULL
  if (inside && be.y > b.y) envMarch(ro, rd, b.y, be.y, jitter, tSkip, col, tr);   // the envelope behind the cylinder
#endif
  // (the share of the pixel's light that the automatic exposure measures: not the star's and the magnetosphere's, kept
  // as they are (their share reckoned without the compensation, so that it does not grow as the exposure falls), nor a
  // cut face, a picture of a quantity laid over in display values)
  const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);
  float lC = dot(colC, LUMW) / uStarK, lT = dot(col, LUMW) - dot(colC, LUMW) + lC;
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

  // The picture is drawn into a float target and shown by this pass, with a dither against banding: a still picture is
  // refined there (see the accumulation in draw).
  // The display: the volume (accT, at the render scale) upsampled to the screen's pixels (bilinear), and the cut face
  // (faceT, at the screen's resolution, premultiplied) laid over it in display values; dithered.
  const SHOW_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uAcc;
uniform sampler2D uFace;
uniform vec2 uDev;
uniform int uFaceOn;
${NOISE_GLSL}
void main(){
  vec3 c = texture(uAcc, gl_FragCoord.xy / uDev).rgb;
  if (uFaceOn != 0) { vec4 f = texelFetch(uFace, ivec2(gl_FragCoord.xy), 0); c = c * (1.0 - f.a) + f.rgb; }
  fragColor = vec4(c + (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0, 1.0);
}`;

  // The field model again in JS, for the field lines and wind parcels drawn as vector strokes in the SVG
  // overlay (kept in step with FIELD_GLSL above).
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const cutOut = (R) => Math.pow(R / MODEL.R_OUT, MODEL.P_OUT);
  const zBase = (Rf) => MODEL.H0 * Math.pow(Rf, 1.25) * Math.sqrt(2 * Math.max(MODEL.LNTAU1 - 1.25 * Math.log(Rf) - cutOut(Rf), 1));
  const SigmaJS = (R) => Math.exp(-Math.log(R) - cutOut(R)) * ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, R);
  const Hof = (R) => MODEL.H0 * Math.pow(R, 1.25);
  // the dead zone's top in units of H (as zKinkH in the GLSL; 0 where there is none) and where the gas is turbulent
  const mriAmpJS = (R) => 1 - ss(0.75 * NONIDEAL.R_TI, 1.15 * NONIDEAL.R_TI, R);
  const zKinkHJS = (R) => Math.sqrt(2 * Math.max(NONIDEAL.Q * Math.log(NONIDEAL.R_DZ / R) - 0.5 * cutOut(R) - NONIDEAL.TI * mriAmpJS(R), 0));
  const accAmpJS = (R) => ss(0.4, 1, zKinkHJS(R));   // where there is an accretion layer (as accAmp in the GLSL)
  // ln of the planet's gap at depth d (as gapLn in PLANET_GLSL)
  const gapLnJS = (R, d) => { const x = (R - PLANET.A) / PLANET.W; return d <= 0 || Math.abs(x) > 3.5 ? 0 : Math.log(1 - d * Math.exp(-x * x)); };
  // The pebbles' response to a gap of depth d: the fraction filtered out of it (1.08 d, at most 0.99), and the pressure
  // maximum just outside it (P ∝ Σ R^-7/4 at the midplane, with the edge cutoff), where they collect. The maximum appears
  // when the depth exceeds about 0.33 (3.36 au; 3.571 au at depth 0.9, 3.585 au at 0.98); the trap's strength grows from
  // there to depth 0.9. Remembered per depth (to 1e-3).
  const trapMemo = new Map();
  function trapOf(d) {
    const key = Math.round(d * 1000);
    let t = trapMemo.get(key);
    if (t) return t;
    let prev = null, rising = false, Rt = PLANET.A + 0.6, found = false;
    for (let R = PLANET.A; R < PLANET.A + 4 * PLANET.W && !found; R += 1e-3) {
      const x = (R - PLANET.A) / PLANET.W, v = -2.75 * Math.log(R) - cutOut(R) + Math.log(1 - d * Math.exp(-x * x));
      if (prev !== null) { if (v > prev) rising = true; else if (rising) { Rt = R - 1e-3; found = true; } }
      prev = v;
    }
    t = { R: Rt, filt: Math.min(0.99, 1.08 * d), s: found ? ss(0.33, 0.9, d) : 0 };
    trapMemo.set(key, t);
    return t;
  }
  // the pebbles relative to the smooth disk (as in sheet)
  const pebbleJS = (R, d) => {
    if (d <= 0 || Math.abs(R - PLANET.A) > 1.6) return 1;
    const t = trapOf(d), xg = (R - PLANET.A) / (1.15 * PLANET.W), xt = (R - t.R) / (0.28 * PLANET.W);
    return (1 - t.filt * Math.exp(-xg * xg)) * (1 + 2.2 * t.s * Math.exp(-xt * xt));
  };
  // Starlight absorbed per unit area with the gap, relative to the smooth disk. Rays leave the star at angles th = 0.09
  // to 0.26 above the midplane (every 0.002; 0.001 gives the same ratio to 1e-4), start at 1.5 au (inside the gap's reach) with the optical depth of the
  // local formula, and cross the gas outward in steps of 0.01 au, depositing e^-tau dtau on the way. The gas is that of
  // the volume (Σ with the gap, Gaussian in height); its opacity k makes dtau/dR agree with the local formula at the
  // surface at 2 au. The ratio of the deposits with and without the gap, on 128 radii from GL_R0 (it eases to 1 toward
  // the end of the table, where the disk lies in its own shadow). A finer trace (from 0.3 au, 2201 rays, steps of
  // 0.0005 au) agrees within 3%. Tabulated at the depths GL_LEVELS, each when first needed (about 2 ms), and
  // interpolated in g = -ln(1 - depth) between neighbours (within 0.008 of a direct trace). gapLight(d, out) fills out.
  // Depth 0.3: 0.75 of the light at the gap's floor, up to 1.09 beyond it; 0.9: 0.13 and 1.35; 0.98: 0.026 and 1.40.
  const GL_LEVELS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.85, 0.92, 0.96, 0.98];
  const gapLight = (() => {
    const R0 = 1.5, dR = 0.01, n = Math.round((9.6 - R0) / dR) + 1;
    const Rg = new Float64Array(n), lnS = new Float64Array(n), ih2 = new Float64Array(n);
    for (let i = 0; i < n; i++) { const R = R0 + i * dR; Rg[i] = R; lnS[i] = -Math.log(R) - cutOut(R) - Math.log(Hof(R)); ih2[i] = 0.5 / (Hof(R) * Hof(R)); }
    const R2 = 2, H2 = Hof(R2), a2 = MODEL.LNTAU1 - 1.25 * Math.log(R2) - cutOut(R2), th2 = H2 * Math.sqrt(2 * a2) / R2;
    const k = (-1.25 / R2 - MODEL.P_OUT * cutOut(R2) / R2 + 0.25 * th2 * th2 * R2 / (H2 * H2)) / Math.exp(-Math.log(R2) - cutOut(R2) - Math.log(H2) - a2);
    const a0 = MODEL.LNTAU1 - 1.25 * Math.log(R0) - cutOut(R0), H0s = Hof(R0);
    const deposit = (d) => {
      const lg = Rg.map((R) => gapLnJS(R, d)), out = new Float64Array(n);
      for (let th = 0.09; th < 0.2605; th += 0.002) {
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
        const R = GL_R0 + j * GL_DR, f = (R - R0) / dR, i = Math.min(n - 2, Math.floor(f)), u = f - i;
        const q = (dep[i] + (dep[i + 1] - dep[i]) * u) / (base[i] + (base[i + 1] - base[i]) * u);
        return 1 + (q - 1) * (1 - ss(8.6, 9.4, R));
      }));
    };
    const fill = (d, out) => {
      const g = gOf(Math.min(Math.max(d, 0), GL_LEVELS[GL_LEVELS.length - 1]));
      let l = 0;
      while (l < GL_LEVELS.length - 2 && gOf(GL_LEVELS[l + 1]) <= g) l++;
      const g0 = gOf(GL_LEVELS[l]), u = Math.min(1, (g - g0) / (gOf(GL_LEVELS[l + 1]) - g0)), a = table(l), b = table(l + 1);
      for (let j = 0; j < 128; j++) out[j] = a[j] + (b[j] - a[j]) * u;
    };
    // makes the next table not yet made (false when all are): for idle time
    fill.prefetch = () => { const l = GL_LEVELS.findIndex((_, i) => !tables[i]); if (l < 0) return false; table(l); return true; };
    return fill;
  })();
  const NT = BP.XI.length;
  if (NT !== 64) throw new Error('the wind table must have 64 rows');
  const tabF = (arr, f) => { f = Math.min(Math.max(f, 0), NT - 1.001); const i = Math.floor(f); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); };
  const tabS = (chi) => Math.log(1 + chi / BP.C0) * ((NT - 1) / BP.SMAX);
  const chiOfS = (sv) => BP.C0 * (Math.exp(sv * BP.SMAX / (NT - 1)) - 1);
  // the line's bend inside the disk (as bendQ in the GLSL; s the asymmetry's signed share for the side), its radius at
  // the wind's base, and the heights to draw it at through the disk (the midplane, the dead zone's top, across the
  // bend, and up to the base)
  function bendQ(Rf, h, zb, s = 0) {
    const H = Hof(Rf), d = Math.min(NONIDEAL.BEND * H, 0.5 * zb), zk = Math.min(zKinkHJS(Rf) * H, zb - d), hi = Math.min(h, zb);
    const q = hi <= zk ? 0 : hi < zk + d ? 0.5 * (hi - zk) * (hi - zk) / d : hi - zk - 0.5 * d;
    return q + s * (hi - q);
  }
  const r0Of = (Rf, s = 0) => { const zb = zBase(Rf); return Rf + BP.A0 * bendQ(Rf, zb, zb, s); };
  function diskHeights(Rf) {
    const zb = zBase(Rf), H = Hof(Rf), d = Math.min(NONIDEAL.BEND * H, 0.5 * zb), zk = Math.min(zKinkHJS(Rf) * H, zb - d);
    const hs = zk > 0.02 * H ? [0, 0.5 * zk, zk] : [0];
    return [...hs, zk + d / 3, zk + 2 * d / 3, zk + d, 0.5 * (zk + d + zb)];
  }
  // radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf at height h (on the side of s)
  function fieldRP(Rf, h, s = 0) {
    const zb = zBase(Rf), q = bendQ(Rf, h, zb, s);
    let R = Rf + BP.A0 * q, ph = BP.B0 * q / Rf;
    if (h > zb) { const f = tabS((h - zb) / R); R *= tabF(BP.XI, f); ph += tabF(BP.PHI, f); }
    return [R, ph];
  }
  // height chi reached after a travel time tau (TAU increases along the table, and tabF interpolates it linearly, so
  // the row is found by bisection over the rows and the place within it solved directly)
  function chiOfTau(tau) {
    const T = BP.TAU;
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
  const CHI_S = (() => {
    const out = [0]; let chi = 0;
    while (chi < BP.CHIMAX) {
      const target = tabF(BP.PHI, tabS(chi)) - 0.4;
      let lo = chi, hi = Math.min(BP.CHIMAX, (chi + BP.C0) * 1.15 - BP.C0);
      if (tabF(BP.PHI, tabS(hi)) < target) for (let i = 0; i < 20; i++) { const m = 0.5 * (lo + hi); if (tabF(BP.PHI, tabS(m)) < target) hi = m; else lo = m; }
      chi = hi; out.push(chi);
    }
    return out;
  })();
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
  function init(box, reuse) {
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
    if (!gl || !fbHalf) { box.classList.add('disk-fallback'); return; }
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
    const [sgroup, sgroup2] = overlay.querySelectorAll('.disk-scale');   // the bar, and the one it replaces as it fades out

    const compile0 = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const compile = (type, src) => { const s = compile0(type, src); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const link = (fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    const uniforms = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    const prog = link(FS), progDisk = link(DISKMAP_FS), progWind = link(WINDMAP_FS), progEnv = link(ENVMAP_FS);
    // the eddies' volume texture (TURB3_FS, then SHADE3_FS), NB3 layers per draw: 8 where the driver allows, else 4
    const NB3 = gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 8 && gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) >= 8 ? 8 : 4;
    const progT3 = link(TURB3_FS(NB3)), progS3 = link(SHADE3_FS(NB3)), progWS = link(WSTR_FS(NB3));
    const UWS = uniforms(progWS, ['uResW', 'uLayer0', 'uTime', 'uSeed']);
    const UT3 = uniforms(progT3, ['uRes3', 'uLayer0', 'uTime', 'uSeed', 'uCam', 'uPixA']), US3 = uniforms(progS3, ['uRes3', 'uLayer0', 'uT3']);
    gl.useProgram(progS3); gl.uniform1i(US3.uT3, 5);
    const UNAMES = ['uCutA', 'uFacePass', 'uFaceRdy', 'uFaceRes', 'uRes', 'uTime', 'uCam', 'uBasis', 'uTanHalf', 'uRSnow', 'uExposure', 'uStar', 'uSteps', 'uSeed', 'uPx', 'uClump', 'uVapor', 'uMode', 'uDiskMap', 'uWindMap', 'uSlice', 'uSliceQ', 'uSliceN', 'uSliceR', 'uSliceZ',
      'uPlanet', 'uTrap', 'uGapRim', 'uPlanetPos', 'uPlanetVis', 'uEnv', 'uEnvMap', 'uSliceOff', 'uSliceFace', 'uLook', 'uComp', 'uTurb3', 'uJit', 'uEnv3', 'uMS', 'uWStr', 'uWindLow', 'uAccMap', 'uAcc', 'uAccV', 'uCoMode', 'uCoV', 'uCoRange', 'uCoK', 'uWindVel', 'uMag', 'uMagAxis', 'uMagE1', 'uMagT', 'uPuffT', 'uPuff', 'uStarK'];
    const U0 = uniforms(prog, UNAMES);
    const progShow = link(SHOW_FS);
    gl.useProgram(progShow); gl.uniform1i(gl.getUniformLocation(progShow, 'uAcc'), 6); gl.uniform1i(gl.getUniformLocation(progShow, 'uFace'), 11);
    const uShowDev = gl.getUniformLocation(progShow, 'uDev'), uShowFace = gl.getUniformLocation(progShow, 'uFaceOn');
    // (a texel of nothing on units 11 and 12 (the cut face, see faceT) until the face is first drawn, and on unit 12 while
    // faceA is drawn into: the samplers must not point at no texture)
    const noFace = gl.createTexture();
    gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, noFace); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, noFace); gl.activeTexture(gl.TEXTURE2);
    const progAE = link(AE_FS), uAeSrc = gl.getUniformLocation(progAE, 'uSrc');
    gl.useProgram(progAE); gl.uniform1i(gl.getUniformLocation(progAE, 'uAcc'), 6);
    // the FULL program, compiled in the background where the driver can (KHR_parallel_shader_compile), otherwise
    // when first needed; null until it is ready, false if it failed (the usual program then stands in). A single
    // frame (reduced motion, a snapshot) waits for it, since no later frame would replace it.
    const pcomp = gl.getExtension('KHR_parallel_shader_compile');
    let full = null, fullP = null, fullWait = false;
    const startFull = () => {
      const p = gl.createProgram();
      gl.attachShader(p, compile0(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile0(gl.FRAGMENT_SHADER, FS.replace('#version 300 es\n', '#version 300 es\n#define FULL\n')));
      gl.linkProgram(p); fullP = p;
    };
    function fullProgram() {
      if (full !== null) return full;
      if (!fullP) startFull();
      if (pcomp && !reduce && !fullWait && !gl.getProgramParameter(fullP, pcomp.COMPLETION_STATUS_KHR)) return null;
      if (!gl.getProgramParameter(fullP, gl.LINK_STATUS)) { console.error('disk3d:', gl.getProgramInfoLog(fullP)); full = false; return full; }
      full = { prog: fullP, U: uniforms(fullP, UNAMES) };
      gl.useProgram(fullP); gl.uniform1i(gl.getUniformLocation(fullP, 'uFaceA'), 12); gl.uniform1i(full.U.uDiskMap, 0); gl.uniform1i(full.U.uWindMap, 1); gl.uniform1i(full.U.uEnvMap, 3); gl.uniform1i(full.U.uTurb3, 4); gl.uniform1i(full.U.uEnv3, 7); gl.uniform1i(full.U.uWStr, 8); gl.uniform1i(full.U.uAccMap, 9); gl.uniform1i(full.U.uWindVel, 10);
      return full;
    }
    if (pcomp) startFull();
    const UD = uniforms(progDisk, ['uMapRes', 'uTime', 'uSeed', 'uCam', 'uPixA', 'uPlanet', 'uPlanetPhi', 'uGapLight', 'uWake', 'uWakeX', 'uAccK']);
    // a full-screen triangle, shared by the passes
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const fLinear = !!gl.getExtension('OES_texture_float_linear');
    function target(w, h, fmt, wrapT) {
      gl.activeTexture(gl.TEXTURE2);      // set up on a spare unit: units 0 and 1 hold the maps the march reads
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
      if (env3T || lost) return;
      const p = link(ENV3_FS(NB3)), t = target3(96, 128, 80, gl.RG16F), uL = gl.getUniformLocation(p, 'uLayer0');
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
    gl.useProgram(progWind);
    gl.uniform4fv(gl.getUniformLocation(progWind, 'uTab'), new Float32Array(BP.XI.flatMap((x, i) => [x, BP.PHI[i], BP.TAU[i], Math.log(BP.ETA[i])])));
    gl.uniform4fv(gl.getUniformLocation(progWind, 'uTabV'), new Float32Array(BP.F.flatMap((F, i) => [F, BP.G[i], BP.XIP[i], 0])));
    gl.uniform2f(gl.getUniformLocation(progWind, 'uMapRes'), windMapT.w, windMapT.h);
    // the wind map (and its velocities) for the asymmetry's share now; drawn again when it changes (during its fade)
    const uAsymSW = gl.getUniformLocation(progWind, 'uAsymS');
    let windMapS = null;
    function drawWindMap(s) {
      if (s === windMapS) return;
      windMapS = s;
      gl.useProgram(progWind); gl.uniform1f(uAsymSW, s);
      gl.bindFramebuffer(gl.FRAMEBUFFER, windMapT.fb); gl.viewport(0, 0, windMapT.w, windMapT.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    drawWindMap(0);   // (the first frame draws it for the state's asymmetry)
    // the envelope map (see ENVMAP_FS), drawn once, on unit 3
    const envMapT = target(256, 128, gl.RGBA16F, gl.CLAMP_TO_EDGE);
    gl.useProgram(progEnv);
    gl.uniform2f(gl.getUniformLocation(progEnv, 'uMapRes'), envMapT.w, envMapT.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, envMapT.fb); gl.viewport(0, 0, envMapT.w, envMapT.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, envMapT.tex);
    gl.useProgram(prog);
    gl.uniform1i(U0.uDiskMap, 0); gl.uniform1i(U0.uWindMap, 1); gl.uniform1i(U0.uTurb3, 4); gl.uniform1i(U0.uWStr, 8); gl.uniform1i(U0.uAccMap, 9);
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
      const nx = Math.min(2048, Math.max(512, 2 ** Math.ceil(Math.log2(rW * 1.6))));
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
      t3a = target3(w3, h3, 40, gl.R16F); t3b = target3(w3, h3, 40, gl.RG16F);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_3D, t3a.tex);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_3D, t3b.tex);
    }
    // the eddies for this moment and view (their detail is faded by the footprints of the pixels)
    // the wind's streamers (WSTR_FS, unit 8): 160 x 64 x 48 texels (about 4.5 per radial cell, 13 around, 4 per lifetime)
    const wstrT = target3(160, 64, 48, gl.R16F);
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_3D, wstrT.tex);
    function windPass() {
      gl.useProgram(progWS);
      gl.uniform3f(UWS.uResW, wstrT.w, wstrT.h, wstrT.d); gl.uniform1f(UWS.uTime, time); gl.uniform1f(UWS.uSeed, opt.seed);
      gl.viewport(0, 0, wstrT.w, wstrT.h);
      for (const f of wstrT.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(UWS.uLayer0, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    function eddyPass() {
      gl.useProgram(progT3);
      gl.uniform3f(UT3.uRes3, t3a.w, t3a.h, t3a.d); gl.uniform1f(UT3.uTime, time); gl.uniform1f(UT3.uSeed, opt.seed);
      gl.uniform3fv(UT3.uCam, cam); gl.uniform1f(UT3.uPixA, 2 * Math.tan(opt.fov / 2) / rH);
      gl.viewport(0, 0, t3a.w, t3a.h);
      for (const f of t3a.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(UT3.uLayer0, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.useProgram(progS3); gl.uniform3f(US3.uRes3, t3b.w, t3b.h, t3b.d);
      for (const f of t3b.fbs) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.uniform1f(US3.uLayer0, f.z0); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // --- field lines and wind parcels: vector strokes in the SVG overlay, from the wind solution ---
    // Each line is a Catmull-Rom spline through its samples, written as cubic Bezier segments; segments are
    // grouped into NB opacity levels, one halo and one core path per level, so the overlay is a fixed set of
    // path elements updated each frame (only those whose data changed). The levels are fine enough (steps of 3% of
    // the core's opacity) that the brightness changes smoothly along a line; the segments end flat (butt caps), so
    // where a line passes from one level to the next the two paths meet without overlapping (the splines are smooth
    // across the joints). The parcels of the wind (and of the envelope) are marks of the flow, not clumps of gas: each is
    // a short dash from where the gas was TRACE_T earlier to where it is now, over a fainter tail from 3 TRACE_T earlier,
    // so that its direction and speed read (the dash's length is proportional to the speed, at most TRACE_MAX px).
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
      for (let m = 0; m < 8; m++) parcels.push({ Rf, phi0, side: 1, u: ((m + 0.37 * i) / 8) % 1, k: () => 1 });
      for (let m = 0; m < 8; m++) parcels.push({ Rf, phi0, side: -1, u: ((m + 0.37 * i) / 8) % 1, k: (a) => 1 - a });
      if (i % 2 === 0) for (let m = 0; m < 4; m++) parcels.push({ Rf, phi0, side: -1, u: ((m + 0.21 * i) / 4) % 1, k: (a) => LOW_LINES * a });
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
      const R0 = 1.2 * Math.pow(6.0 / 1.2, u1), phi0 = 2 * Math.PI * u2;
      accMarks.push({ R0, phi0, side: 1, u: (0.618034 * i) % 1 });
      accMarks.push({ R0, phi0: phi0 + 2.4, side: -1, u: (0.618034 * i + 0.5) % 1 });
    }
    // starlight reaching a point at radius R and height h: softened falloff with the distance from the star,
    // shadowed inside the disk (optical depth toward the star)
    const starlight = (R, h) => {
      const Hs = MODEL.H0 * Math.pow(R, 1.25);
      const tau = Math.exp(Math.min(Math.max(MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) - 0.5 * h * h / (Hs * Hs), -30), 30));
      return (0.2 + 0.8 * Math.exp(-tau)) / (1 + (R * R + h * h) / 225);
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
      const s = L.side * sNow, zb = zBase(L.Rf), r0 = r0Of(L.Rf, s), inDisk = diskHeights(L.Rf);
      const chiEnd = Math.min(Math.max((ZTOP - zb) / r0, 0.5), BP.CHIMAX);
      L.r0 = r0; L.pts = [];
      for (let j = 0, k = 0; ; j++) {
        let h, chi = 0;
        if (j < inDisk.length) h = inDisk[j];
        else { if (k >= CHI_S.length) break; chi = Math.min(CHI_S[k++], chiEnd); h = zb + r0 * chi; }
        const [R, dphi] = fieldRP(L.Rf, h, s);
        const fade = Math.exp(-(h - Math.min(h, zb)) / (1.5 * r0 + 2)) * (1 - ss(0.85 * chiEnd, chiEnd, chi)) * (1 - ss(0.6, 1, chi / BP.CHIMAX)) * (1 - ss(30, RB_JS, R));
        L.pts.push({ R, dphi, z: L.side * h, b: fade * starlight(R, h) });
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
    const halo = [], core = [], dots = [];
    for (let b = 0; b < NB; b++) halo.push(mkPath({ fill: 'none', stroke: '#8cb8ff', 'stroke-width': 30, 'stroke-opacity': Math.min(0.6, 0.18 * level(b)).toFixed(3), 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }));
    for (let b = 0; b < NB; b++) core.push(mkPath({ fill: 'none', stroke: '#bed7ff', 'stroke-width': 10, 'stroke-opacity': Math.min(1, level(b)).toFixed(3), 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }));
    for (let b = 0; b < NBM; b++) dots.push(mkPath({ fill: 'none', stroke: '#c7e6ff', 'stroke-width': 11, 'stroke-opacity': Math.min(1, level(b, NBM)).toFixed(3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const edots = [], elines = mkPath({ fill: 'none', stroke: '#c9d8f5', 'stroke-width': 8, 'stroke-linecap': 'round' });
    const adots = [];   // the accretion's marks, amber
    for (let b = 0; b < NBM; b++) adots.push(mkPath({ fill: 'none', stroke: '#ffbe6a', 'stroke-width': 11, 'stroke-opacity': Math.min(1, level(b, NBM)).toFixed(3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    for (let b = 0; b < NBM; b++) edots.push(mkPath({ fill: 'none', stroke: '#eef3ff', 'stroke-width': 13, 'stroke-opacity': Math.min(1, level(b, NBM)).toFixed(3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
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
    const magG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    fieldG.after(magG);
    const magPath = (w, op) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      for (const [k, v] of [['fill', 'none'], ['stroke', 'rgb(225,235,255)'], ['stroke-width', w], ['stroke-opacity', op], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) e.setAttribute(k, v);
      magG.appendChild(e); return e;
    };
    const magClosed = magPath(1, 0.5), magEdge = magPath(1.3, 0.8), magOpen = magPath(1, 0.45), magCurt = magPath(1.2, 0.85), magX = magPath(1.6, 0.95);
    magCurt.setAttribute('stroke', 'rgb(255,120,150)');
    magX.setAttribute('stroke', 'rgb(255,236,170)');
    const magXL = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    for (const [k, v] of [['font-size', 11], ['fill', 'rgba(255,236,170,0.95)'], ['text-anchor', 'middle']]) magXL.setAttribute(k, v);
    magG.appendChild(magXL);
    const MAG_LINES = [0.022, 0.032, 0.044], MAG_FEET = [0.066, 0.08, 0.1, 0.13];
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
      if (a <= 0.01) { for (const e of [magClosed, magEdge, magOpen, magCurt, magX]) if (e.getAttribute('d')) e.setAttribute('d', ''); magXL.textContent = ''; return; }
      const { ax: m, e1 } = magFrame, e2 = [m[1] * e1[2] - m[2] * e1[1], m[2] * e1[0] - m[0] * e1[2], m[0] * e1[1] - m[1] * e1[0]];
      const fmt = (q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1);
      // a polyline through the points, broken where hidden (visible(P) false) or behind the camera
      const poly = (pts, visible) => {
        let d = '', pen = false;
        for (const P of pts) {
          const q = project(P);
          if (q[2] <= zN || !visible(P)) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + fmt(q); pen = true;
        }
        return d;
      };
      const vis = (P) => kept(P) && !behindStar(P) && sheetT(P) > 0.5;
      let dC = '', dE = '';
      for (const L of [...MAG_LINES, MAG.RT]) {
        const th0 = Math.asin(Math.sqrt(MAG.RS / L));
        for (let k = 0; k < 8; k++) {
          const ph = (k + 0.5) * Math.PI / 4, cp = Math.cos(ph), sp = Math.sin(ph), pts = [];
          for (let j = 0; j <= 32; j++) {
            const th = th0 + (Math.PI - 2 * th0) * j / 32, r = L * Math.sin(th) * Math.sin(th), st = r * Math.sin(th), ct = r * Math.cos(th);
            pts.push([0, 1, 2].map((i) => st * (cp * e1[i] + sp * e2[i]) + ct * m[i]));
          }
          if (L === MAG.RT) dE += poly(pts, vis); else dC += poly(pts, vis);
        }
      }
      let dO = '';
      const sNow = linesS || 0;
      MAG_FEET.forEach((Rf, i) => {
        for (const side of [1, -1]) {
          const s = side * sNow, zb = zBase(Rf), r0 = r0Of(Rf, s), rot = 1.7 * i + Omega(r0) * time;
          const hs = [...diskHeights(Rf), ...CHI_S.map((chi) => zb + r0 * chi)];
          for (let k = 0; k < 6; k++) {
            const pts = [];
            for (const h of hs) {
              const [R, dphi] = fieldRP(Rf, h, s);
              if (R > 0.25 || h > 0.25) break;
              const ph = rot + k * Math.PI / 3 + dphi;
              pts.push([R * Math.cos(ph), R * Math.sin(ph), side * h]);
            }
            dO += poly(pts, vis);
          }
        }
      });
      // the curtains: the middle line of their bundle, L = MAG.RT (1 + MAG.DL / 2), at the azimuths where they are dense
      // (as magAz on the GPU), from the disk to the star, north on the side the dipole tilts to and south on the other
      let dK = '';
      const Lc = MAG.RT * (1 + 0.5 * MAG.DL), thc = Math.asin(Math.sqrt(MAG.RS / Lc));
      for (const north of [1, -1]) for (let k = -4; k <= 4; k++) {
        const dph = k * Math.PI / 9, ph = (north > 0 ? 0 : Math.PI) + dph, cp = Math.cos(ph), sp = Math.sin(ph), pts = [];
        if (Math.pow(0.5 + 0.5 * Math.cos(dph), 3) < 0.15) continue;
        for (let j = 0; j <= 24; j++) {
          const th = north > 0 ? Math.PI / 2 - (Math.PI / 2 - thc) * j / 24 : Math.PI / 2 + (Math.PI / 2 - thc) * j / 24;
          const r = Lc * Math.sin(th) * Math.sin(th), st = r * Math.sin(th), ct = r * Math.cos(th);
          pts.push([0, 1, 2].map((i) => st * (cp * e1[i] + sp * e2[i]) + ct * m[i]));
        }
        dK += poly(pts, vis);
      }
      // the X-point: where the star's last closed line (L = MAG.RT) meets the disk's open lines, on the ring at the
      // truncation radius; marked where the ring shows at the sides of the star (across the line of sight), with a label
      let dX = '', lx = null;
      const azC = Math.atan2(cam[1], cam[0]);
      for (const sgn of [1, -1]) {
        const ph = azC + sgn * Math.PI / 2, P = [MAG.RT * Math.cos(ph), MAG.RT * Math.sin(ph), 0], q = project(P);
        if (q[2] <= zN || !vis(P)) continue;
        dX += 'M' + (q[0] - 5) + ' ' + (q[1] - 5) + 'L' + (q[0] + 5) + ' ' + (q[1] + 5) + 'M' + (q[0] - 5) + ' ' + (q[1] + 5) + 'L' + (q[0] + 5) + ' ' + (q[1] - 5);
        if (!lx || q[0] > lx[0]) lx = q;
      }
      magClosed.setAttribute('d', dC); magEdge.setAttribute('d', dE); magOpen.setAttribute('d', dO); magCurt.setAttribute('d', dK); magX.setAttribute('d', dX);
      if (lx) { magXL.setAttribute('x', lx[0].toFixed(1)); magXL.setAttribute('y', (lx[1] - 9).toFixed(1)); magXL.textContent = ja() ? 'X 点' : 'X-point'; } else magXL.textContent = '';
      magG.setAttribute('opacity', a.toFixed(3));
    }
    function sheetT(P) {
      if ((cam[2] > 0) === (P[2] > 0)) return 1;
      const t = cam[2] / (cam[2] - P[2]);
      const cx = cam[0] + (P[0] - cam[0]) * t, cy = cam[1] + (P[1] - cam[1]) * t, Rc = Math.sqrt(cx * cx + cy * cy);
      if (Rc < MODEL.R_IN || Rc > RB_JS) return 1;
      const dx = P[0] - cam[0], dy = P[1] - cam[1], dz = P[2] - cam[2], mu = Math.abs(dz) / Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ice = 1 - ss(MODEL.TICE - 6, MODEL.TICE + 6, MODEL.TICE * Math.sqrt(rSn / Rc));
      return Math.exp(-MODEL.K_D * MODEL.SD0 * SigmaJS(Rc) * pebbleJS(Rc, gapDepth) * (0.5 + 0.5 * ice) / Math.max(mu, 0.03));
    }
    // the starlight scattered toward the observer at P (relative to 90 degrees), behind the sheet or not (written
    // without Math.hypot, which is slow, as these run for every sample of every line in every frame)
    function seen(P) {
      const vx = cam[0] - P[0], vy = cam[1] - P[1], vz = cam[2] - P[2];
      const mu = (P[0] * vx + P[1] * vy + P[2] * vz) / ((Math.sqrt(P[0] * P[0] + P[1] * P[1] + P[2] * P[2]) || 1e-3) * Math.sqrt(vx * vx + vy * vy + vz * vz));
      return phaseWind(mu) * sheetT(P);
    }
    const fx = (v) => Math.round(v * 10);
    // a tracer: dash from qb to q (the head) at brightness a, tail from qt to q at TRACE_TAIL a, both shortened on the
    // screen to at most max and 2.5 max px, added to the paths of the marks d (by level)
    const TRACE_T = 0.3, TRACE_MAX = 14, TRACE_TAIL = 0.3;
    function tracer(d, q, qb, qt, a, max = TRACE_MAX) {
      const cut = (from, max) => { const dx = from[0] - q[0], dy = from[1] - q[1], l = Math.sqrt(dx * dx + dy * dy); return l > max ? [q[0] + dx * max / l, q[1] + dy * max / l] : from; };
      const hb = qb[2] > zN ? cut(qb, max) : q, ht = qt[2] > zN && qb[2] > zN ? cut(qt, 2.5 * max) : hb;
      const head = 'L' + fx(q[0]) + ' ' + fx(q[1]);
      if (a * TRACE_TAIL > 0.02 && ht !== hb) d[bucket(a * TRACE_TAIL, NBM)] += 'M' + fx(ht[0]) + ' ' + fx(ht[1]) + 'L' + fx(hb[0]) + ' ' + fx(hb[1]) + head;
      d[bucket(a, NBM)] += 'M' + fx(hb[0]) + ' ' + fx(hb[1]) + head;
    }
    let fieldPts = [];   // the field lines' visible samples on the screen this frame (x, y pairs), which the snow line's label avoids
    function drawField() {
      fieldPts = [];
      if (fieldAmp <= 0) { for (const e of [...halo, ...core, ...dots]) setD(e, ''); return; }
      const gain = Number(box.dataset.field || 0.5) * (opt.slice ? 0.6 : 1);   // quieter behind a slice
      const dL = new Array(NB).fill(''), dD = new Array(NBM).fill('');
      const asymS = asymAmp * asymAmp * (3 - 2 * asymAmp);
      shapeLines(Math.round(ASYM_F_JS * asymS * 100) / 100);
      for (const L of lines) {
        const kL = L.k(asymS);
        if (kL <= 0.004) continue;
        const rot = L.phi0 + Omega(L.r0) * time, n = L.pts.length;
        const Q = new Array(n), A = new Array(n);   // projected samples (null behind the camera) and their brightness
        for (let j = 0; j < n; j++) {
          const s = L.pts[j], phi = rot + s.dphi;
          const P = [s.R * Math.cos(phi), s.R * Math.sin(phi), s.z], q = project(P);
          if (q[2] > zN && kept(P)) { Q[j] = q; A[j] = s.b * kL * gain * seen(P) * (1 - faceAlpha(P)); if (A[j] > 0.04) fieldPts.push(q[0], q[1]); } else { Q[j] = null; A[j] = 0; }
        }
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
      for (const p of parcels) {
        // parcels released at a steady rate, each moving with the flow of the solution: dense where the
        // gas is slow near the base, spread out as it accelerates. Where it was dt earlier (not before its release):
        // along the line (its phase) and with the line's turning
        const kP = p.k(asymS) * marksAmp;
        if (kP <= 0.004) continue;
        const sP_ = p.side * linesS, zb = zBase(p.Rf), r0 = r0Of(p.Rf, sP_), Om = Omega(r0);
        const chiEnd = Math.min(Math.max((ZTOP - zb) / r0, 0.5), BP.CHIMAX), tEnd = tabF(BP.TAU, tabS(chiEnd));
        const ph = ((p.u + time * Om / tEnd) % 1 + 1) % 1;
        const at = (dt) => {
          const c = chiOfTau(Math.max(0, ph - dt * Om / tEnd) * tEnd), hh = zb + r0 * c;
          const [Rr, dp] = fieldRP(p.Rf, hh, sP_), f = p.phi0 + Om * (time - dt) + dp;
          return [Rr * Math.cos(f), Rr * Math.sin(f), p.side * hh];
        };
        const chi = chiOfTau(ph * tEnd), h = zb + r0 * chi;
        const [R, dphi] = fieldRP(p.Rf, h, sP_), phi = p.phi0 + Om * time + dphi;
        const P = [R * Math.cos(phi), R * Math.sin(phi), p.side * h], q = project(P);
        if (q[2] <= zN || !kept(P)) continue;
        const a = ss(0, 0.03, ph) * (1 - ss(0.6, 1, ph)) * Math.exp(-(h - zb) / (2 * r0 + 2.5)) * (1 - ss(0.6, 1, chi / BP.CHIMAX)) * kP * gain * starlight(R, h) * seen(P) * (1 - faceAlpha(P));
        // (the tail's far end continues the dash backward, which is close enough for a faint tail and saves a third
        // look-up in the table per parcel)
        if (a > 0.02) { const B = at(TRACE_T); tracer(dD, q, project(B), project([3 * B[0] - 2 * P[0], 3 * B[1] - 2 * P[1], 3 * B[2] - 2 * P[2]]), 0.85 * a); }
      }
      for (let b = 0; b < NB; b++) { setD(halo[b], dL[b]); setD(core[b], dL[b]); }
      for (let b = 0; b < NBM; b++) setD(dots[b], dD[b]);
    }

    function drawAcc() {
      const dD = new Array(NBM).fill(''), w = accW(), k = accK(), gainA = 0.9 * modelAmp * compAmp[0] * marksAmp;
      if (gainA > 0.02) for (const m of accMarks) {
        const ws = m.side > 0 ? w[0] : w[1], ks = m.side > 0 ? k[0] : k[1];
        if (ws <= 0.01) continue;
        const c = 1.25 * ks * MODEL.H0 * 0.5236, e0 = Math.pow(m.R0, 1.25), e1 = Math.pow(ACC.R_END, 1.25), T = (e0 - e1) / c;
        const ph = ((time / T + m.u) % 1 + 1) % 1;
        const at = (t) => {
          const R = Math.pow(Math.max(e0 - c * t, e1), 0.8), phi = m.phi0 + 4 * (Math.pow(R, -0.25) - Math.pow(m.R0, -0.25)) / (ks * MODEL.H0);
          return [R * Math.cos(phi), R * Math.sin(phi), m.side * (zKinkHJS(R) + ACC.OFF) * Hof(R)];
        };
        const t = ph * T, P = at(t), q = project(P);
        if (q[2] <= zN || !kept(P)) continue;
        const a = ws * gainA * ss(0, 0.04, ph) * (1 - ss(0.85, 1, ph)) * accAmpJS(Math.hypot(P[0], P[1])) * sheetT(P) * (1 - faceAlpha(P));
        if (a > 0.02) { const B = at(Math.max(0, t - TRACE_T)); tracer(dD, q, project(B), project([3 * B[0] - 2 * P[0], 3 * B[1] - 2 * P[1], 3 * B[2] - 2 * P[2]]), a); }
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
        const du = TRACE_T * ENV.SPEED / L.T;
        if (a > 0.02) tracer(dD, q, project(pointAt(u - du)), project(pointAt(u - 3 * du)), 0.45 * a, 8);
      }
      for (let b = 0; b < NBM; b++) setD(edots[b], dD[b]);
    }

    const opt = {
      rSnow: Number(box.dataset.snow || 0.9),
      el: Number(box.dataset.elevation || 32) * Math.PI / 180,
      az: Number(box.dataset.azimuth || -70) * Math.PI / 180,
      dist: Number(box.dataset.distance || 90),
      fov: Number(box.dataset.fov || 32) * Math.PI / 180,
      scale: Number(box.dataset.scale || 0.6),
      steps: Number(box.dataset.steps || 150),
      exposure: Number(box.dataset.exposure || 1.0),
      spin: Number(box.dataset.spin || 0.004),
      seed: Number(box.dataset.seed || 2.0),
      mode: Number(box.dataset.mode || 63),   // see uMode; 16: the planet, 32: the envelope
      scaleMax: Number(box.dataset.scaleMax || 1),
      // the cutaway (see uCutA): open with data-slice, a quarter cut away with data-cut="quarter" (else half);
      // data-slice-q picks the quantity on the cut faces
      slice: 'slice' in box.dataset,
      cut: box.dataset.cut === 'quarter' ? 'quarter' : 'half',
      sliceQ: box.dataset.sliceQ || 'T',
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
      // the marks of the flows (the wind's and the envelope's dashes, the accretion's marks, the arrows on the cut faces):
      // off unless data-marks="on" (they read as clumps; without them the patterns carried by the flows remain, the
      // wind's streamers and the accretion's streaks)
      marks: box.dataset.marks === 'on',
      // the waves' emphasis (the planet's wake exaggerated, see wake): off unless data-waves="on"
      waves: box.dataset.waves === 'on'
    };
    const clumps = Array.from({ length: 6 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0, crossed: true }));
    const vapor = Array.from({ length: 4 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0 }));
    let W = 0, Hh = 0, rW = 1, rH = 1, faceT = null, faceA = null, cam, basis, time = 0, last = 0, running = false, dragging = false, moved = false, px = 0, py = 0, azUser = opt.az, elUser = opt.el;
    let paused = false, speed = 1, dirty = true, benching = false, fieldMs = 0;
    const Omega = (R) => 0.5236 * Math.pow(R, -1.5);
    // --- the planet: it fades in and out over about 1.5 s when it is turned on or off (planetAmp); the gap's depth is
    // planetAmp times the depth for the camera's distance (DEPTH), gapDepth, and the wake's strength planetAmp times
    // the strength for that distance, wakeAmp (the observed looks take the near values of both); the waves' emphasis
    // eases in and out (wavesAmp) ---
    const planetPhi = (t) => PLANET.PHI0 + Omega(PLANET.A) * t;
    const planetPos = (t) => { const a = planetPhi(t); return [PLANET.A * Math.cos(a), PLANET.A * Math.sin(a), 0]; };
    let planetAmp = (opt.mode & 16) ? 1 : 0, depthSet = -1, gapDepth = 0, rim = null, trap = trapOf(0), wakeAmp = 0, wavesAmp = opt.waves ? 1 : 0;
    const glNow = new Float32Array(128);
    // how near the camera is to the planet's orbit: 0 beyond D1, 1 within D0
    const nearOf = (c) => 1 - ss(DEPTH.D0, DEPTH.D1, Math.hypot(Math.hypot(c[0], c[1]) - PLANET.A, c[2]));
    const depthFor = (c) => DEPTH.FAR + (DEPTH.NEAR - DEPTH.FAR) * nearOf(c);
    const wakeFor = (c) => DEPTH.WAKE_FAR + (1 - DEPTH.WAKE_FAR) * nearOf(c);
    // the inner rim of the gap: where z_s/R, the surface's angle seen from the star, peaks inside the gap; its shadow
    // ends where the outer wall climbs above that angle again (null when the gap is too shallow to cast one)
    function gapRim(d) {
      const sA = (R) => Hof(R) * Math.sqrt(2 * Math.max(MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) + gapLnJS(R, d), 1)) / R;
      const dR = 0.0005;
      let R = PLANET.A - 3.5 * PLANET.W, prev = sA(R);
      for (; R < PLANET.A; R += dR) { const v = sA(R + dR); if (v < prev) break; prev = v; }
      if (R >= PLANET.A) return null;
      const out = { R, th: prev, h: Hof(R) / R };
      for (R += dR; R < PLANET.A + 3.5 * PLANET.W && sA(R) < out.th; R += dR);
      out.end = R;
      return out;
    }
    // --- easter eggs ---
    // An FU Orionis outburst (clicking the star): accretion onto the star surges for a while and its luminosity rises
    // thirtyfold in about 1.5 s, holds for 4 s and decays over some 30 s of the model clock (real outbursts last decades;
    // the luminosity of FU Ori objects rises a hundredfold or so). The midplane temperature follows L^1/4, so the snow
    // line moves out as L^1/2, here to about 5 au: the pebbles' ice sublimates inside it and freezes again as it comes
    // back (in V883 Ori, in outburst, ALMA found the snow line near 40 au; Cieza et al. 2016).
    let burst = null, rSn = opt.rSnow;
    const burstL = () => {
      if (!burst) return 1;
      const dt = time - burst.t0;
      if (dt < 0 || dt > 60) { burst = null; return 1; }
      // (the decay tapered to nothing from 40 to 60 s, so that the exposure and the snow line do not step at its end)
      return 1 + 29 * ss(0, 1.5, dt) * (dt < 5.5 ? 1 : Math.exp(-(dt - 5.5) / 9)) * (1 - ss(40, 60, dt));
    };
    const snowNow = () => { rSn = opt.rSnow * Math.sqrt(burstL()); };
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
    const KEYS_JA = 'ドラッグで回転、Shift+ドラッグ(または中・右ボタン)で見る中心を動かす。タッチでは指 1 本で移動、2 本の指でピンチしてズーム、ひねって回転、そろえて上下に動かして傾き、ダブルタップで拡大、2 本指のタップで縮小。キー:矢印で回転、Shift+矢印で中心を動かす、＋と−でズーム(ホイールのズームはこの図にフォーカスしてから)、Home で元の視点と星の中心、C で中心を星に戻す(視点はそのまま)、スペースで一時停止、1〜5 で視点、P で惑星に寄る、F で磁力線、S で断面、A で注釈、B で星の増光、G で惑星を育てる。円盤をクリックすると、そこに小石の塊を置きます。';
    const KEYS_EN = 'Drag to turn, Shift+drag (or the middle or right button) to move the point looked at. On a touch screen one finger moves, two fingers pinch to zoom, twist to turn and move up or down together to tilt; a double tap zooms in, a two-finger tap zooms out. Keys: arrows turn, Shift+arrows move the point looked at, + and - zoom (the wheel zooms once this picture has the focus), Home returns to the first view centred on the star, C brings the point looked at back to the star (the view kept), space pauses, 1 to 5 pick views, P goes to the planet, F toggles the field lines, S the cut, A the annotations, B makes the star flare, G grows the planet. A click on the disk drops a clump of pebbles there.';
    let toastTimer = 0, toastSwap = 0, toastMsg = null;   // toastMsg: the text showing, in both languages
    // shows a text for ms; one already showing fades out first (0.25 s), so texts never swap abruptly
    const say = (ja_, en, ms) => {
      clearTimeout(toastTimer); clearTimeout(toastSwap);
      const show = () => { toastMsg = [ja_, en]; toast.textContent = ja() ? ja_ : en; toast.style.transition = 'opacity .45s'; toast.style.opacity = '1'; toastTimer = setTimeout(hush, ms); };
      if (toast.style.opacity === '1') { toast.style.transition = 'opacity .25s'; toast.style.opacity = '0'; toastSwap = setTimeout(show, 260); } else show();
    };
    const hush = () => { clearTimeout(toastTimer); clearTimeout(toastSwap); toast.style.transition = 'opacity .6s'; toast.style.opacity = '0'; };
    // on a narrow panel (a phone) the box is smaller and sits at the bottom, above the scale bar, so that it leaves the
    // picture's upper part and the cut's legend free; a tap on it puts it away
    const toastFit = () => {
      const n = W > 0 && W < 560;
      Object.assign(toast.style, n ? { top: 'auto', bottom: '42px', left: '8px', right: '8px', maxWidth: 'none', fontSize: '11.5px', lineHeight: '1.55', padding: '7px 10px', pointerEvents: 'auto' }
        : { top: '12px', bottom: 'auto', left: 'auto', right: '12px', maxWidth: 'min(360px,calc(100% - 24px))', fontSize: '12.5px', lineHeight: '1.65', padding: '9px 12px', pointerEvents: 'none' });
    };
    toast.addEventListener('click', hush);
    const startBurst = () => {
      if (reduce || (burst && time - burst.t0 < 8)) return;   // the clock does not run with reduced motion
      burst = { t0: time };
      say('FU オリオン型の増光:星への降着が一時的に急増して、星が約 30 倍明るくなりました。円盤が温まってスノーラインが約 5 au まで外へ動き、小石の氷が昇華します。降着が収まると暗くなり、水は再び凍ります(実際の増光は数十年続きます。オリオン座 V883 では、増光中のスノーラインが約 40 au にあります)。',
        'An FU Orionis outburst: accretion onto the star surges and it brightens about thirtyfold. The disk warms, the snow line moves out to about 5 au and the pebbles\u2019 ice sublimates; as the accretion calms down the star dims and the water freezes again (real outbursts last decades; in V883 Ori the snow line lies near 40 au during the outburst).', 14000);
    };
    // Growing the planet (with the planet turned off): three clumps of pebbles dropped within 0.6 au of its orbit in
    // 20 s of the model clock make a core there; it gathers gas, grows to Jupiter's mass and opens its gap (the gap
    // fades in over 8 s instead of 1.5).
    let seeds = [], planetFade = 1.5;
    const seedPlanet = (R) => {
      if ((opt.mode & 16) || Math.abs(R - PLANET.A) > 0.6) return;
      seeds = seeds.filter((t) => time - t < 20).concat([time]);
      if (seeds.length < 3) return;
      seeds = []; planetFade = 8; opt.mode |= 16;
      box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: opt.mode } }));
      emitState();
      // from afar the gap would be drawn shallow (DEPTH): come closer to watch it open
      if (Math.hypot(Math.hypot(cam[0], cam[1]) - PLANET.A, cam[2]) > 9) box.diskSet({ p: 0, slice: 0, el: Math.min(45, Math.max(25, camEl * 180 / Math.PI)), az: camAz * 180 / Math.PI, d: 10, fly: 1 });
      say('小石が 3 au に集まって惑星の核ができ、まわりのガスを集めて木星ほどの惑星に育ちました。惑星はガスを押しのけてギャップを開け、すぐ外に小石がたまります(実際には数十万年以上かかります)。',
        'The pebbles gathered at 3 au into a planetary core; it pulled in the gas around it and grew to the mass of Jupiter. The planet pushes the gas aside into a gap, and pebbles pile up just outside it (in reality this takes hundreds of thousands of years or more).', 12000);
    };

    // --- the envelope: fades in and out with its component (1.5 s) and shows from about 150 au (envVis) ---
    let envAmp = (opt.mode & 32) ? 1 : 0, envVis = 0;
    // its infall: particles on NS streamlines (SVG dots, like the wind's), from r = 225 au down to the disk's surface
    // (z/R below 0.17), moving ENV.SPEED times faster than the disk's clock, and the streamlines themselves, faint.
    // Each streamline is integrated once in theta (800 steps) with the velocities of ENV, then resampled at equal
    // times (for the particles) and every 40 steps (for the line).
    const GM = 0.5236 * 0.5236;           // au^3 per (visual s)^2: one orbit a year at 1 au (12 s)
    const envLines = [];
    for (let i = 0; i < ENV.NS; i++) {
      const [u1, u2] = sobol2(i + 37);
      const th0 = ENV.TH_CAV + 0.08 + (1.38 - ENV.TH_CAV - 0.08) * u1, c0 = Math.cos(th0), s0 = Math.sin(th0), RC = MODEL.R_OUT;
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
    // the depth for this view (to 1e-3), the starlight on the gap, its rim and the pebble trap
    function planetUniforms() {
      const d = Math.round(planetAmp * (lookNow === 'model' ? depthFor(cam) : DEPTH.NEAR) * 1000) / 1000;
      if (d === depthSet) return;
      depthSet = gapDepth = d;
      gapLight(d, glNow);
      gl.useProgram(progDisk); gl.uniform4fv(UD.uGapLight, glNow); gl.uniform1f(UD.uPlanet, d);
      rim = gapRim(d); trap = trapOf(d);
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
      if (flyT) { panV = clampPan(panOf(camT)); flyT = null; camTV = [0, 0, 0]; }
      if (!flyV) return;
      elUser = clampEl(camEl); azUser = camAz - viewOff(); opt.dist = camD; flyV = null; camV = [0, 0, 0];
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
    const SLICE_Q = { none: 0, T: 1, rho: 2, tau: 3, layers: 4 };
    const sliceG = overlay.querySelector('.disk-slice');
    // the CO look's colour bar and channel velocity (top left; the cut, whose bar sits there, is closed in the observed
    // looks)
    const coG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    overlay.appendChild(coG);
    const LN10 = Math.LN10, lnEta = BP.ETA.map(Math.log), CHI_C = 0.03;
    // ln tau* toward the star with the planet's gap, behind its inner rim at least that of the rim (as xRim)
    const lnTauJS = (R, z) => {
      const x = MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) + gapLnJS(R, gapDepth) - 0.5 * z * z / (Hof(R) * Hof(R));
      if (!rim || R <= rim.R) return x;
      const th = Math.abs(z) / R, xr = 0.5 * (rim.th * rim.th - th * th) / (rim.h * rim.h);
      return x + (Math.max(x, xr) - x) * (1 - ss(rim.end, rim.end + 0.5, R));
    };
    // height where ln tau* = lt (the irradiation surface for lt = 0), and where the disk gas is 10^lr of the
    // midplane at 1 au; NaN where the column does not reach it. Behind the gap's rim tau* is found by bisection.
    const zOfTau = (R, lt) => {
      if (rim && R > rim.R && R < rim.end + 0.5) {
        if (lnTauJS(R, 0) < lt) return NaN;
        let lo = 0, hi = 0.5 * R;
        for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (lnTauJS(R, m) > lt) lo = m; else hi = m; }
        return 0.5 * (lo + hi);
      }
      const a = MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) + gapLnJS(R, gapDepth) - lt;
      return a > 0 ? Hof(R) * Math.sqrt(2 * a) : NaN;
    };
    const zOfRho = (R, lr) => { const v = Math.log(SigmaJS(R) * Math.exp(gapLnJS(R, gapDepth)) * MODEL.H0 / Hof(R)) - lr * LN10; return v > 0 ? Hof(R) * Math.sqrt(2 * v) : NaN; };
    const sliceGeom = {};               // lines in (R, z), R >= 0 and z >= 0, built once per quantity and gap depth
    // the wake (as in the disk map, without the footprint): relative excess of the gas density at R, azimuth phi
    const wakeJS = (R, phi) => {
      const x = R / PLANET.A;
      if (wakeAmp <= 0 || x < 0.42 || x > 2.5) return 0;
      const F = 4.8 - 4 * Math.pow(x, -0.25) - 0.8 * Math.pow(x, 1.25), TAU = 2 * Math.PI;
      const dphi = ((phi - planetPhi(time) - Math.sign(x - 1) * F / PLANET.HP + Math.PI) % TAU + TAU) % TAU - Math.PI;
      const sl = Math.pow(x, 1.25) * Math.abs(Math.pow(x, -1.5) - 1) / PLANET.HP, c = 1 / Math.sqrt(1 + sl * sl);
      const ax = Math.abs(x - 1), w = Hof(R) * (1 + 0.5 * ax), d = R * dphi * c;
      const amp = PLANET.WAKE_P * Math.pow(Math.max(ax, PLANET.WAKE_X0) / PLANET.WAKE_X0, -0.75) * (1 - wavesAmp) + PLANET.WAKE_A * Math.exp(-ax / PLANET.WAKE_L) * wavesAmp;
      return wakeAmp * amp * ss(0.03, 0.1, ax) * ss(0.42, 0.55, x) * (1 - ss(2, 2.5, x)) * Math.exp(-d * d / (w * w));
    };
    // the disk's density contours on the two faces (or halves of the face; at the azimuths of cutE), across the arms:
    // finely sampled where the arms are
    let wakeR = null;
    function wakeContours(lr) {
      wakeR = wakeR || [...logspace(MODEL.R_IN * 1.05, 1.2, 40), ...logspace(1.21, 7.6, 420), ...logspace(7.65, RB_JS - 1, 60)];
      const out = [];
      for (const [sr, ph] of [[1, Math.atan2(cutE[1][1], cutE[1][0])], [-1, Math.atan2(cutE[0][1], cutE[0][0])]]) {
        const pts = [];
        for (const R of wakeR) {
          const v = Math.log(SigmaJS(R) * Math.exp(gapLnJS(R, gapDepth)) * (1 + wakeJS(R, ph)) * MODEL.H0 / Hof(R)) - lr * LN10;
          if (v > 0) pts.push([R, Hof(R) * Math.sqrt(2 * v)]);
        }
        if (pts.length > 2) out.push(pathOf(pts, [[sr, 1], [sr, -1]]));
      }
      return out.join('');
    }
    const logspace = (a, b, n) => Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
    function buildSlice(q) {
      const key = q + ':' + Math.round(gapDepth * 50) + ':' + rSn.toFixed(3) + ':' + (opt.asym ? 1 : 0) + ':' + (q === 'none' ? ja() : '');
      if (sliceGeom.key === key) return sliceGeom.g;
      const g = { lines: [], labels: [] };
      const curve = (f, R0, R1) => logspace(R0, R1, 160).map((R) => [R, f(R)]).filter((pt) => !isNaN(pt[1]));
      if (q === 'T') {
        // isotherms: vertical in each layer (T_mid in the interior, 2.8 T_mid above the irradiation surface)
        for (const T of [1000, 300, 100]) {
          const Ri = rSn * Math.pow(MODEL.TICE / T, 2), Rs = rSn * Math.pow(2.8 * MODEL.TICE / T, 2);
          if (Ri > MODEL.R_IN && Ri < 10) { g.lines.push([[Ri, 0], [Ri, zOfTau(Ri, 0)]]); g.labels.push({ R: Ri, z: 0.5 * zOfTau(Ri, 0), t: T + ' K', side: 1 }); }
          if (Rs > MODEL.R_IN && Rs < 10) { g.lines.push([[Rs, zOfTau(Rs, 0)], [Rs, zOfTau(Rs, -4.6)]]); g.labels.push({ R: Rs, z: zOfTau(Rs, -4.6), t: T + ' K', side: 1 }); }
        }
      } else if (q === 'rho') {
        // the disk (above 10^-3 of the midplane at 1 au) and, along the field lines, the wind (10^-5 to 10^-7); with the
        // planet, the disk's contours are drawn each frame instead, across the arms of its wake (wakeContours)
        for (const lr of [1, -1, -3]) {
          const c = curve((R) => zOfRho(R, lr), MODEL.R_IN * 1.05, RB_JS - 1);
          if (c.length > 2) { g.lines.push({ pts: c, quads: ALL, lr }); g.labels.push({ pts: c, t: '10' + sup(lr) }); }
        }
        // (the lower side has its own contours, at 0.1 of the upper with the wind's asymmetry, and its lines' own bases)
        const lowW = opt.asym ? WIND_LOW_JS : 1, sideS = opt.asym ? ASYM_F_JS : 0;
        for (const [lr, low, lower] of [[-5, 1, 0], [-6, 1, 0], [-7, 1, 0], [-5, lowW, 1], [-6, lowW, 1], [-7, lowW, 1]]) {
          const c = [];
          for (const Rf of logspace(0.07, 30, 180)) {
            const zb = zBase(Rf), r0 = r0Of(Rf, lower ? -sideS : sideS);
            const base = -MODEL.LNTAU1 - 1.5 * Math.log(r0) - tabF(lnEta, tabS(CHI_C)) - cutOut(r0) + gapLnJS(r0, gapDepth) + Math.log(Math.max(ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, r0) * low, 1e-30));
            const want = lr * LN10 - base;   // ln ETA at the contour
            if (want > tabF(lnEta, tabS(CHI_C)) || want < lnEta[NT - 1]) continue;
            let lo = tabS(CHI_C), hi = NT - 1.001;
            for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (tabF(lnEta, m) > want) lo = m; else hi = m; }
            const chi = chiOfS(0.5 * (lo + hi)), z = zb + r0 * chi;
            if (z < ZB_JS) c.push([r0 * tabF(BP.XI, tabS(chi)), z]);
          }
          if (c.length > 2) { g.lines.push({ pts: c, quads: lower ? LOWER : UPPER }); if (!lower) g.labels.push({ pts: c, t: '10' + sup(lr) }); }
        }
      } else if (q === 'none') {
        // the cutaway: a thin outline of the disk where the cut passes through it (10^-3 of the midplane at 1 au, as the
        // density's face shows the disk) and two contours inside it (10^1, 10^-1), so that the open cut reads as a
        // cross-section; with the planet, across the arms of its wake (as the density's)
        for (const lr of [1, -1, -3]) {
          const c = curve((R) => zOfRho(R, lr), MODEL.R_IN * 1.05, RB_JS - 1);
          if (c.length < 3) continue;
          (lr === -3 ? (g.outline = []) : g.lines).push({ pts: c, quads: ALL, lr });
          g.labels.push({ pts: c, t: lr === -3 ? (ja() ? '円盤の縁(密度 10' + sup(lr) + ')' : 'edge of the disk (density 10' + sup(lr) + ')') : '10' + sup(lr) });
        }
      } else if (q === 'tau') {
        for (const k of [-3, -2, -1, 1, 2, 3, 4]) {
          const c = curve((R) => zOfTau(R, k * LN10), MODEL.R_IN * 1.05, RB_JS - 1);
          if (c.length > 2) { g.lines.push(c); g.labels.push({ pts: c, t: 'τ* = 10' + sup(k) }); }
        }
      }
      sliceGeom.key = key; sliceGeom.g = g;
      g.tau1 = logspace(MODEL.R_IN, RB_JS - 1, 300).map((R) => [R, zOfTau(R, 0)]).filter((pt) => !isNaN(pt[1]));
      g.ice = [[rSn, 0], ...logspace(rSn, rIceS(), 80).map((R) => [R, zOfTau(R, 0)]), [rIceS(), zOfTau(rIceS(), -4.6)]];
      return g;
    }
    const sup = (k) => String(k).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    // lines on every face: the irradiation surface (tau* = 1); the ice boundary, vertical at the snow line in
    // the interior and along the irradiation surface out to where 2.8 T_mid = 160 K; the pebble layer; the
    // field lines in the plane (the R-z shape of the solution) with points for the wind velocity
    const rIceS = () => rSn * 2.8 * 2.8;
    // (per side, for the asymmetry's share: made again when it changes)
    let planeLines = [], planeS = null;
    function shapePlaneLines(sNow) {
      if (sNow === planeS) return;
      planeS = sNow;
      planeLines = logspace(0.12, 25, 12).map((Rf) => {
        const side = (s) => {
          const zb = zBase(Rf), r0 = r0Of(Rf, s), pts = [];
          for (const h of diskHeights(Rf)) pts.push([fieldRP(Rf, h, s)[0], h, -1]);
          for (const chi of CHI_S) { const h = zb + r0 * chi, R = fieldRP(Rf, h, s)[0]; if (h > ZB_JS - 0.5 || R > RB_JS) break; pts.push([R, h, chi]); }
          return { r0, pts };
        };
        return { up: side(sNow), low: side(-sNow) };
      });
    }
    const vK = (r0) => 29.78 / Math.sqrt(r0);   // km/s, for a star of one solar mass (one orbit a year at 1 au)
    const ACC_PX = 6;                            // the accretion's arrows on the cut faces: px per km/s
    // a slice element: a path with fixed style, or a pool of labels
    const mkS = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); sliceG.appendChild(e); return e; };
    const sP = {
      contour: mkS('path', { fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.55, 'stroke-width': 0.9 }),
      outline: mkS('path', { fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.8, 'stroke-width': 1.2 }),
      flines: mkS('path', { fill: 'none', stroke: '#cfe3ff', 'stroke-opacity': 0.5, 'stroke-width': 0.8 }),
      arrows: mkS('path', { fill: 'none', stroke: '#e8f4ff', 'stroke-opacity': 0.85, 'stroke-width': 1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      tau1: mkS('path', { fill: 'none', stroke: '#fff3df', 'stroke-opacity': 0.95, 'stroke-width': 1.5 }),
      ice: mkS('path', { fill: 'none', stroke: '#9fe0ff', 'stroke-width': 1.6, 'stroke-dasharray': '4 4' }),
      rock: mkS('path', { fill: 'none', stroke: '#b07a52', 'stroke-width': 2.2 }),
      icy: mkS('path', { fill: 'none', stroke: '#e3f1ff', 'stroke-width': 2.2 }),
      pile: mkS('path', { fill: 'none', stroke: '#f2f8ff', 'stroke-width': 4 }),
      planet: mkS('path', { fill: '#ffd9a8', stroke: '#0a0d18', 'stroke-width': 1 }),
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
      const l = Math.log(T), st = [[3.69, 4.50, [0.071, 0.325, 1.000]], [4.50, 4.98, [0.485, 0.755, 1.000]], [4.98, 5.16, [1.000, 0.852, 0.612]],
        [5.16, 5.86, [1.000, 0.325, 0.047]], [5.86, 6.68, [1.000, 0.682, 0.302]], [6.68, 7.38, [1.000, 0.914, 0.793]]];
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
      T: { col: (u) => tcolorJS(T0 * Math.pow(T1 / T0, u)), ticks: [50, 160, 300, 1000].map((T) => [uT(T), String(T)]), title: ['温度 (K)', 'temperature (K)'] },
      rho: { col: (u) => cmapJS(u, 'viridis'), ticks: [-9, -6, -3, 0].map((l) => [(l + 10) / 12.5, '10' + sup(l)]), title: ['ガスの密度(1 au の赤道面に対する比)', 'gas density (relative to the midplane at 1 au)'] },
      tau: { col: (u) => cmapJS(u, 'inferno'), ticks: [-3, 0, 3].map((l) => [(l + 4) / 9, '10' + sup(l)]), title: ['星の方向の光学的厚さ τ*', 'optical depth toward the star τ*'] },
      // the layers of the coupling: swatches (the colours of layersFace)
      layers: { swatches: [['#e0784a', '乱流', 'turbulent'], ['#273157', 'デッドゾーン', 'dead zone'], ['#7094c2', '層流の表層', 'laminar surface'], ['#ffb547', '降着層', 'accretion'], ['#a3d9f2', '風', 'wind']],
        title: ['磁場とガスの結合(非理想 MHD)', 'coupling of field and gas (non-ideal MHD)'] }
    };
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
        const sw = q === 'layers' && magFrame.vis > 0.5 ? [...c.swatches, ['#9a7adb', '磁気圏', 'magnetosphere'], ['#ff5c80', '降着カーテン', 'accretion curtain'], ['#faa385', 'ダストのないガス', 'dust-free gas']] : c.swatches;
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
      backTo(cbarBack, Math.max(18 + CBW + 14, 18 + textW(title)), 53);
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
      const j = ja(), rng = coRange(), mode = opt.coMode, key = mode + ':' + (mode === 'm1' ? rng.toFixed(1) : '');   // (the colours; the ticks are set each frame)
      const div = (u) => { const v = 2 * u - 1, g = [0.60, 0.61, 0.64], b = [0.20, 0.36, 0.92], r = [0.88, 0.16, 0.12]; return g.map((c, i) => c + ((v < 0 ? b : r)[i] - c) * Math.abs(v)); };
      const spec = mode === 'm1' ? { col: div, ticks: [[0, '−' + rng.toFixed(0)], [0.5, '0'], [1, '+' + rng.toFixed(0)]], title: ['平均の視線速度 (km/s、赤は遠ざかる)', 'mean line-of-sight velocity (km/s, red receding)'] }
        : mode === 'm0' ? { col: (u) => cmapJS(u, 'inferno'), ticks: coTicks(900 * Math.exp(coLn), [1 / 9, 4 / 9, 1]), title: ['CO の積分強度 (K km/s)', 'CO integrated intensity (K km/s)'] }
        : { col: (u) => cmapJS(u, 'inferno'), ticks: coTicks(220 * Math.exp(coLn), [25 / 220, 100 / 220, 1]), title: ['CO の輝度温度 (K)', 'CO brightness temperature (K)'] };
      if (coE.key !== key) {
        coE.grad.innerHTML = Array.from({ length: 25 }, (_, i) => { const u = i / 24, k = spec.col(u).map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))); return '<stop offset="' + u.toFixed(3) + '" stop-color="rgb(' + k.join(',') + ')"/>'; }).join('');
        coE.key = key;
      }
      let d = '', n = 0;
      const txt = (x, y, t, anchor) => { const e = coE.texts[n++]; e.textContent = t; e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('text-anchor', anchor || 'start'); };
      for (const [u, t] of spec.ticks) { const x = 18 + CBW * u; d += 'M' + x.toFixed(1) + ' 32L' + x.toFixed(1) + ' 36'; txt(x, 47, t, 'middle'); }
      coE.ticks.setAttribute('d', d);
      txt(18, 18, spec.title[j ? 0 : 1]);
      // (the channel's velocity beside the bar, or under it on a narrow panel)
      const ch = (j ? 'チャンネル ' : 'channel ') + (opt.coV >= 0 ? '+' : '−') + Math.abs(opt.coV).toFixed(2) + ' km/s', chW = textW(ch), below = 18 + CBW + 14 + chW > W - 14;
      if (mode === 'chan') { if (below) txt(18, 66, ch); else txt(18 + CBW + 14, 33, ch); }
      while (n < coE.texts.length) coE.texts[n++].textContent = '';
      backTo(coE.back, Math.max(18 + CBW + 14 + (mode === 'chan' && !below ? chW : 0), 18 + textW(spec.title[j ? 0 : 1])), mode === 'chan' && below ? 72 : 53);
    }
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
        let pen = false;
        for (const [R, z] of pts) {
          const q = sp(sr * R, sz * z);
          if (q[2] <= zN) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true;
        }
      }
      return d;
    }
    const ALL = [[1, 1], [-1, 1], [1, -1], [-1, -1]], UPPER = ALL.slice(0, 2), LOWER = ALL.slice(2);
    // opacity of the face where the segment from the camera to P leaves the part cut away (P kept): hides the field
    // lines and particles behind it (the density face covers the wind as well)
    function faceAlpha(P) {
      if (sliceU < 0.82 || opt.sliceQ === 'none') return 0;
      const off = sliceOff();
      let t = Infinity;
      for (const n of cutN) {
        const cn = cam[0] * n[0] + cam[1] * n[1] - off, pn = P[0] * n[0] + P[1] * n[1] - off;
        if (cn <= 0) return 0;
        if (pn <= 0) t = Math.min(t, cn / (cn - pn));
      }
      if (!isFinite(t)) return 0;
      const C = [cam[0] + (P[0] - cam[0]) * t, cam[1] + (P[1] - cam[1]) * t, cam[2] + (P[2] - cam[2]) * t];
      const R = Math.hypot(C[0], C[1]), z = C[2] / SZ;
      if (opt.sliceQ === 'rho') return R < RB_JS - 1 && Math.abs(z) < ZB_JS - 1 ? ss(0.82, 1, sliceU) : 0;
      const x = lnTauJS(Math.max(R, 1e-3), z), hole = ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, R);
      return (opt.sliceQ === 'T' ? ss(-6, -4.5, x) : opt.sliceQ === 'layers' ? (Math.abs(z) <= zBase(R) ? 1 : 0) : ss(-4.5, -3.5, x / LN10)) * hole * ss(0.82, 1, sliceU);
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
    const SWEEP = RB_JS, CUT_A = { half: 0, quarter: Math.PI / 4 };
    let sliceU = opt.slice ? 1 : 0, annAmp = opt.ann ? 1 : 0;   // annAmp: the annotations' fade (0.4 s)
    let cutA = CUT_A[opt.cut], cutN = [[1, 0, 0], [1, 0, 0]], cutE = [[0, -1, 0], [0, 1, 0]], faceSeen = [true, true];
    function cutFrame() {
      const c = Math.cos(2 * cutA), s = Math.sin(2 * cutA), n = basis.n, r = basis.r;
      cutN = [[c * n[0] + s * r[0], c * n[1] + s * r[1], 0], [n[0], n[1], 0]];
      cutE = [[s * n[0] - c * r[0], s * n[1] - c * r[1], 0], [r[0], r[1], 0]];
      faceSeen = [c > 0.3, true];   // (the turned plane, seen more and more edge-on)
    }
    // A change of look dips the exposure for 0.6 s and takes effect at its darkest (lookNow), so the picture never
    // jumps; the model's own drawings (field lines, wind tracers, the envelope's streamlines) fade out in the observed
    // looks (fieldAmp, which also fades the field lines' toggle).
    let lookNow = opt.look, lookT0 = -1e9, fieldAmp = 1;
    // Other fades (in real time, as the others): the components gas, surface, pebbles and wind (compAmp, 0.6 s; uComp),
    // the model's drawings of the envelope between looks (modelAmp, 0.4 s), the scale bar when it changes its length
    // (the old bar fades out as the new one fades in, 0.25 s; both are true to scale)
    const COMP_BITS = [1, 2, 4, 8], compAmp = COMP_BITS.map((b) => (opt.mode & b ? 1 : 0));
    let modelAmp = opt.look === 'model' ? 1 : 0, sbLb = 0, sbOld = 0, sbT = -1e9, msAmp = opt.ms ? 1 : 0, asymAmp = opt.asym ? 1 : 0, marksAmp = opt.marks ? 1 : 0;
    const toward = (cur, want, dt, secs) => (reduce ? want : want > cur ? Math.min(want, cur + dt / secs) : Math.max(want, cur - dt / secs));
    // Close to the star the model's clock runs slower, (d / MAG.SHOW)^1.5 within MAG.SHOW au (d the camera's distance from
    // the star), so that the gas the camera frames turns at about the same rate on the screen: an orbit at the
    // magnetosphere's edge takes 0.13 s at the usual rate, 12 s from 0.1 au. (A choice for the picture; the state's time
    // is the model's.)
    // (only close to the magnetosphere: from 0.3 au in, reaching (d / MAG.SHOW)^1.5 at 0.15 au, geometrically between, so
    // that the planet's view, 2-4 au from the star, keeps the usual clock)
    const clockK = () => {
      if (!cam) return 1;
      const d = Math.hypot(cam[0], cam[1], cam[2]);
      return Math.exp(Math.log(Math.min(1, Math.pow(d / MAG.SHOW, 1.5))) * (1 - ss(0.15, 0.3, d)));
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
    const fadesDone = () => COMP_BITS.every((b, i) => compAmp[i] === (opt.mode & b ? 1 : 0)) && modelAmp === (lookNow === 'model' ? 1 : 0) && performance.now() - sbT >= 250 && msAmp === (opt.ms ? 1 : 0) && asymAmp === (opt.asym ? 1 : 0) && marksAmp === (opt.marks ? 1 : 0) && wavesAmp === (opt.waves ? 1 : 0);
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
      const lines = (ls) => ls.map((c) => (Array.isArray(c) ? pathOf(c, ALL) : c.lr != null && wakeAmp > 0 ? wakeContours(c.lr) : pathOf(c.pts, c.quads))).join('');
      sP.contour.setAttribute('d', lines(g.lines));
      sP.outline.setAttribute('d', lines(g.outline || []));
      sP.tau1.setAttribute('d', pathOf(g.tau1, ALL));
      sP.ice.setAttribute('d', pathOf(g.ice, ALL));
      // the pebble layer: rock inside the snow line, ice outside, thick where it piles up (just outside the snow line,
      // and at the planet's pressure maximum); broken across the planet's gap
      const spans = (R0, R1, ok) => { const out = []; let a = null; for (let R = R0; R <= R1 + 1e-9; R += 0.01) { if (ok(R)) { if (a === null) a = R; } else if (a !== null) { out.push([a, R]); a = null; } } if (a !== null) out.push([a, R1]); return out; };
      const segs = (list) => list.map(([a, b]) => pathOf([[a, 0], [b, 0]], UPPER)).join('');
      const peb = (R) => pebbleJS(R, gapDepth);
      sP.rock.setAttribute('d', segs(spans(MODEL.R_IN, rSn, (R) => peb(R) > 0.3)));
      sP.icy.setAttribute('d', segs(spans(rSn, 31, (R) => peb(R) > 0.3)));
      sP.pile.setAttribute('d', segs([[rSn * 1.02, rSn * 1.3], ...spans(Math.max(rSn, 2), 31, (R) => peb(R) > 1.8)]));
      // the planet's orbit, where it crosses the plane
      sP.planet.setAttribute('d', planetAmp > 0.5 ? [-1, 1].map((sr) => { const c = sp(sr * PLANET.A, 0); return c[2] > zN ? 'M' + (c[0] - 4).toFixed(1) + ' ' + c[1].toFixed(1) + 'l4 -4l4 4l-4 4z' : ''; }).join('') : '');
      // field lines in the plane, and arrows for the gas velocity in the plane, (v_R, v_z) = v_K(r0) F (dxi/dchi, 1),
      // spaced along the lines on the screen, 0.6 px per km/s (at most 42 px); fewer below with the wind's asymmetry
      let dF = '', dA = '';
      shapePlaneLines(Math.round(ASYM_F_JS * asymSm() * 100) / 100);
      if (showField) for (const L of planeLines) dF += pathOf(L.up.pts, UPPER) + pathOf(L.low.pts, LOWER);
      if ((opt.mode & 8) && opt.marks) for (const L0 of planeLines) for (const [sr, sz] of ALL) {
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
          const f = tabS(chi), v = tabF(BP.F, f) * Math.hypot(1, tabF(BP.XIP, f)) * vK(L.r0);
          const ux = q2[0] - q[0], uy = q2[1] - q[1], ul = Math.hypot(ux, uy) || 1, len = Math.min(42, 0.6 * v);
          if (len < 4) continue;
          const ex = q[0] + ux / ul * len, ey = q[1] + uy / ul * len, hx = ux / ul * 4, hy = uy / ul * 4;
          dA += 'M' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
              + 'M' + (ex - hx - hy * 0.7).toFixed(1) + ' ' + (ey - hy + hx * 0.7).toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
              + 'L' + (ex - hx + hy * 0.7).toFixed(1) + ' ' + (ey - hy - hx * 0.7).toFixed(1);
        }
      }
      sP.flines.setAttribute('d', dF);
      sP.arrows.setAttribute('d', dA);
      // the dead zone's top (not on the layers' face, which fills it)
      sP.dead.setAttribute('d', opt.sliceQ === 'layers' ? '' : pathOf(deadTop, ALL));
      // the accretion's inflow along its layer(s), on the side(s) that accrete: arrows toward the star, ACC_PX px per km/s
      // (the inflow is a few km/s, ten times slower than the wind), with the gas
      let dAcc = '';
      const aw = accW(), ak = accK();
      if ((opt.mode & 1) && opt.marks) for (const R of [0.55, 0.8, 1.15, 1.65, 2.4, 3.5, 5]) for (const [sr, sz] of ALL) {
        if (!faceSeen[sr > 0 ? 1 : 0]) continue;
        if ((sz > 0 ? aw[0] : aw[1]) < 0.5 || accAmpJS(R) < 0.5) continue;
        const v = (sz > 0 ? ak[0] : ak[1]) * MODEL.H0 * Math.pow(R, 0.25) * vK(R), len = Math.min(40, ACC_PX * v);
        const z = (zKinkHJS(R) + ACC.OFF) * Hof(R), q = sp(sr * R, sz * z), q2 = sp(sr * R * 0.97, sz * z);
        if (q[2] <= zN || q2[2] <= zN || !inView(q)) continue;
        const ux = q2[0] - q[0], uy = q2[1] - q[1], ul = Math.hypot(ux, uy) || 1;
        const ex = q[0] + ux / ul * len, ey = q[1] + uy / ul * len, hx = ux / ul * 4, hy = uy / ul * 4;
        dAcc += 'M' + q[0].toFixed(1) + ' ' + q[1].toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
            + 'M' + (ex - hx - hy * 0.7).toFixed(1) + ' ' + (ey - hy + hx * 0.7).toFixed(1) + 'L' + ex.toFixed(1) + ' ' + ey.toFixed(1)
            + 'L' + (ex - hx + hy * 0.7).toFixed(1) + ' ' + (ey - hy - hx * 0.7).toFixed(1);
      }
      // labels, on the right half of the upper face where they fall inside the picture, without overlaps (in
      // order of importance; the contour labels are spread across the right half)
      li = drawCbar(opt.sliceQ, li);
      const boxes = [[0, 0, CBW + 30, 52]], textW = (t) => [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 11 : 6.3), 0);
      const place = (x, y, t, anchor) => {
        const w = textW(t), x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, b = [x0 - 2, y - 11, x0 + w + 2, y + 3];
        if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > Hh - 24 || boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
        boxes.push(b); sLabel(li++, x, y, t, anchor);
        return true;
      };
      const at = (pts, xFrac) => { let best = null; for (const [R, z] of pts) { const q = sp(R, z); if (inView(q) && (!best || Math.abs(q[0] - xFrac * W) < Math.abs(best[0] - xFrac * W))) best = q; } return best; };
      if (dA) {
        const x0 = W - 36, y0 = Hh - 18;   // 30 km/s at 0.6 px per km/s
        sP.arrows.setAttribute('d', dA + 'M' + x0 + ' ' + y0 + 'L' + (x0 + 18) + ' ' + y0 + 'M' + (x0 + 14) + ' ' + (y0 - 3) + 'L' + (x0 + 18) + ' ' + y0 + 'L' + (x0 + 14) + ' ' + (y0 + 3));
        boxes.push([x0 - 60, y0 - 12, W, Hh]); sLabel(li++, x0 - 6, y0 + 4, '30 km/s', 'end');
      }
      if (dAcc) {
        const x0 = W - 36, y0 = Hh - 36, l = 3 * ACC_PX;   // 3 km/s
        sP.acc.setAttribute('d', dAcc + 'M' + (x0 + 18 - l) + ' ' + y0 + 'L' + (x0 + 18) + ' ' + y0 + 'M' + (x0 + 14) + ' ' + (y0 - 3) + 'L' + (x0 + 18) + ' ' + y0 + 'L' + (x0 + 14) + ' ' + (y0 + 3));
        boxes.push([x0 - 80, y0 - 12, W, y0 + 6]); sLabel(li++, x0 + 12 - l, y0 + 4, (ja_ ? '降着 ' : 'accretion ') + '3 km/s', 'end');
      } else sP.acc.setAttribute('d', '');
      let q = at(g.tau1, 0.62); if (q) place(q[0], q[1] - 6, opt.sliceQ === 'layers' ? (ja_ ? '風の根元(τ* = 1)' : 'wind base (τ* = 1)') : 'τ* = 1', 'middle');
      if (opt.sliceQ === 'layers') {
        // the regions, on the right face where they fall inside the picture (the accretion layer on its side)
        const zk = (R) => zKinkHJS(R) * Hof(R), za = (R) => (zKinkHJS(R) + ACC.OFF) * Hof(R), sideA = accW()[0] >= 0.5 ? 1 : -1;
        const tries = [[[[0.16, 0], [0.2, 0], [0.24, 0]], ja_ ? '乱流(熱電離)' : 'turbulent (thermally ionized)'],
          [[[1.2, 0.35 * zk(1.2)], [1.8, 0.35 * zk(1.8)], [2.6, 0.35 * zk(2.6)]], ja_ ? 'デッドゾーン(オーム散逸)' : 'dead zone (Ohmic)'],
          [[[1.6, 0.5 * (za(1.6) + zBase(1.6))], [2.3, 0.5 * (za(2.3) + zBase(2.3))], [3.2, 0.5 * (za(3.2) + zBase(3.2))]], ja_ ? '層流の表層(両極性拡散)' : 'laminar surface (ambipolar)'],
          [[[2.0, sideA * za(2.0)], [2.8, sideA * za(2.8)], [3.8, sideA * za(3.8)]], ja_ ? '降着層' : 'accretion layer'],
          [[[2.5, 2.2 * zBase(2.5)], [3.5, 2.2 * zBase(3.5)]], ja_ ? '風' : 'wind']];
        for (const [pts, t] of tries) { const q2 = at(pts, 0.6); if (q2) place(q2[0] + 4, q2[1] + 4, t); }
        // (close to the star: the magnetosphere's labels, on every face, below)
      } else {
        q = at(deadTop.filter((pt) => pt[0] > 1.2 && pt[0] < 3), 0.7); if (q) place(q[0], q[1] + 13, ja_ ? 'デッドゾーンの上端' : 'top of the dead zone', 'middle');
      }
      q = sp(PLANET.A, 0); if (planetAmp > 0.5 && inView(q)) place(q[0] + 8, q[1] - 8, ja_ ? '惑星の軌道' : 'planet orbit');
      q = sp(rSn, 0.55 * zOfTau(rSn, 0)); if (inView(q)) place(q[0] - 5, q[1], ja_ ? '氷の境界' : 'ice line', 'end');
      q = at([[0.5 * (MODEL.R_IN + rSn), 0], [2, 0], [4, 0]], 0.72); if (q) place(q[0], q[1] + 15, ja_ ? '小石の層' : 'pebbles', 'middle');
      // (the 1/4 cut: through its face, below the disk's thin layer, lies the space under the disk behind it, dark, beside
      // the left half of the disk left whole: named, as it reads as a hole)
      sP.edge.setAttribute('d', '');
      if (opt.cut === 'quarter' && sliceU >= 0.82) {
        const sz = cam[2] >= 0 ? -1 : 1, qL = sp(0.3 * camD, sz * 0.14 * camD);
        if (inView(qL)) place(qL[0], qL[1], sz < 0 ? (ja_ ? '円盤の下の空間(切り口ごしに)' : 'the space under the disk, through the cut') : (ja_ ? '円盤の上の空間(切り口ごしに)' : 'the space over the disk, through the cut'), 'middle');
      }
      // close to the star, on every face: the closed magnetosphere (no disk there), the curtains' cross-section (named, so
      // that they are not taken for the disk's own flows), the X-points at the truncation radius, the dust-free gas disk
      let dXp = '';
      if (magFrame.vis > 0.5 && opt.sliceQ !== 'none') {
        let q2 = sp(0.55 * MAG.RT, 0.45 * MAG.RT); if (inView(q2)) place(q2[0], q2[1], ja_ ? '磁気圏(閉じた磁力線、円盤なし)' : 'magnetosphere (closed lines, no disk)', 'middle');
        // (the curtain's label where a curtain crosses the face: of the four places, each face and each hemisphere, the
        // densest, as magAz on the GPU with the dipole as it has turned)
        const Lc = MAG.RT * (1 + 0.5 * MAG.DL), th = 0.95, rr = Lc * Math.sin(th) * Math.sin(th), { ax: mA, e1: mE } = magFrame;
        const mE2 = [mA[1] * mE[2] - mA[2] * mE[1], mA[2] * mE[0] - mA[0] * mE[2], mA[0] * mE[1] - mA[1] * mE[0]];
        const cands = [];
        for (const sr of [1, -1]) for (const sz of [1, -1]) {
          const e = cutE[sr > 0 ? 1 : 0], P = [rr * Math.sin(th) * e[0], rr * Math.sin(th) * e[1], sz * rr * Math.cos(th)], r3 = Math.hypot(...P);
          const cz = (P[0] * mA[0] + P[1] * mA[1] + P[2] * mA[2]) / r3, phm = Math.atan2(P[0] * mE2[0] + P[1] * mE2[1] + P[2] * mE2[2], P[0] * mE[0] + P[1] * mE[1] + P[2] * mE[2]);
          const dph = cz > 0 ? phm : Math.PI - Math.abs(phm);
          cands.push({ w: Math.pow(0.5 + 0.5 * Math.cos(dph), 3), sr, sz });
        }
        // (the densest place where the label fits)
        for (const c of cands.sort((a2, b2) => b2.w - a2.w)) {
          if (c.w < 0.3) break;
          if (!faceSeen[c.sr > 0 ? 1 : 0]) continue;
          q2 = sp(c.sr * rr * Math.sin(th), c.sz * rr * Math.cos(th));
          if (inView(q2) && place(q2[0] + (c.sr > 0 ? 8 : -8), q2[1] + (c.sz > 0 ? -10 : 14), ja_ ? '磁気圏降着(カーテン)' : 'magnetospheric accretion (curtain)', c.sr > 0 ? 'start' : 'end')) break;
        }
        for (const sr of [1, -1]) {
          const qx = sp(sr * MAG.RT, 0);
          if (!faceSeen[sr > 0 ? 1 : 0] || qx[2] <= zN || !inView(qx)) continue;
          dXp += 'M' + (qx[0] - 5) + ' ' + (qx[1] - 5) + 'L' + (qx[0] + 5) + ' ' + (qx[1] + 5) + 'M' + (qx[0] - 5) + ' ' + (qx[1] + 5) + 'L' + (qx[0] + 5) + ' ' + (qx[1] - 5);
        }
        q2 = sp(MAG.RT, 0); if (inView(q2)) place(q2[0] + 8, q2[1] - 8, ja_ ? 'X 点' : 'X-point');
        q2 = sp(0.5 * (MAG.RT * (1 + MAG.DL) + MODEL.R_IN), 0); if (inView(q2)) place(q2[0], q2[1] + 16, ja_ ? 'ダストのないガス円盤' : 'dust-free gas disk', 'middle');
      }
      sP.xpt.setAttribute('d', dXp);
      g.labels.forEach((lb, i) => {
        const q2 = lb.pts ? at(lb.pts, 0.55 + 0.08 * (i % 5)) : sp(lb.R, lb.z);
        if (inView(q2)) place(q2[0] + 4, q2[1] - 4, lb.t);
      });
      for (let i = li; i < sLabels.length; i++) sLabels[i].textContent = '';
    }
    function resize() {
      // the height follows data-aspect when given (the canvas's default size would otherwise set it)
      W = box.clientWidth; Hh = box.dataset.aspect ? Math.round(W * Number(box.dataset.aspect)) : (box.clientHeight || Math.round(W * 0.62));
      box.style.height = Hh + 'px';
      toastFit();
      if (lost) return;   // (without a context: the static picture shows, and the canvas is sized when the context is back)
      // the canvas at the screen's pixels (the cut face is drawn there, faceT), the volume at the render scale (accT,
      // rW x rH, upsampled by SHOW_FS)
      const dprS = Math.min(window.devicePixelRatio || 1, 2), dpr = dprS * opt.scale;
      canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
      const cw = Math.max(1, Math.round(W * dprS)), ch = Math.max(1, Math.round(Hh * dprS));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      rW = Math.max(1, Math.round(W * dpr)); rH = Math.max(1, Math.round(Hh * dpr));
      overlay.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      diskTarget();
      if (accT) { gl.deleteFramebuffer(accT.fb); gl.deleteTexture(accT.tex); }
      accT = target(rW, rH, gl.RGBA16F, gl.CLAMP_TO_EDGE);
      if (faceT && (faceT.w !== cw || faceT.h !== ch)) { for (const t of [faceT, faceA]) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); } faceT = faceA = null; for (const u of [gl.TEXTURE11, gl.TEXTURE12]) { gl.activeTexture(u); gl.bindTexture(gl.TEXTURE_2D, noFace); } }
      accN = 0;   // (the new target is empty: a still starts over, else its next frame would be averaged with nothing)
      gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, accT.tex);
      draw();
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
    // motion it is found at once (blocking reads, up to five frames).
    const AE = { D: 12, TARGET: 0.46, BLOWN: 0.02, DEAD: 0.06, GAIN: 3, STEP: 1.2, MIN: 0.01, TRIES: 8 };
    const aeT = target(AE_W, AE_H, gl.RGBA8, gl.CLAMP_TO_EDGE), aeBuf = gl.createBuffer(), aePx = new Uint8Array(AE_W * AE_H * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, aeBuf); gl.bufferData(gl.PIXEL_PACK_BUFFER, AE_W * AE_H * 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let aeLn = 0, aeGoal = 0, aeSync = null, aeLnUsed = 0, aeFresh = true, aeTries = 0;
    let aeLo = -Infinity, aeHi = Infinity;   // ln of exposures found too dark and too bright for this view (bisection)
    let aeGen = 0, aeGenUsed = 0, aeKey = '';  // the view's count, that of the frame being measured (an older one is not used),
                                               // and the view, coarsely (the clock running does not make a new one)
    const aeOn = () => lookNow === 'model' && !!cam && Math.hypot(cam[0], cam[1], cam[2]) < AE.D;
    const aeHeld = () => !!burst || lookDip() < 1;
    function aePass() {   // the measurement of the frame in accT, into aeT
      gl.bindFramebuffer(gl.FRAMEBUFFER, aeT.fb); gl.viewport(0, 0, AE_W, AE_H);
      gl.useProgram(progAE); gl.uniform2f(uAeSrc, rW, rH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // A new goal for ln of the exposure from the cells read back (of a frame drawn at lnUsed); true when it moved. Too
    // bright: blown out over AE.BLOWN, or the mean level over AE.TARGET; too dark: under it, with a margin from the blown
    // limit, and the exposure under 1. A step is a part of the Newton step (the display level moves about a fifth as much
    // as the exposure, in ln; blown pixels count as ln 1.1 per percent over), at most AE.STEP; between exposures known to
    // be too bright and too dark for this view it goes halfway, and it settles on the darker side when they are close.
    function aeAim(px, lnUsed) {
      let s = 0, b = 0, w = 0;
      for (let i = 0; i < px.length; i += 4) { s += px[i]; b += px[i + 1]; w += px[i + 2]; }
      if (aeTries >= AE.TRIES) { aeFresh = true; return false; }
      // (nothing to measure: cut faces or the star cover nearly all of the picture; back to 1)
      if (w < 0.05 * 255 * AE_W * AE_H) { aeFresh = true; if (lnUsed === 0) return false; aeGoal = 0; return true; }
      const m = s / w, blown = b / w, e = Math.log(Math.max(m, 1e-3) / AE.TARGET);
      const bright = blown > AE.BLOWN || e > AE.DEAD, dark = !bright && lnUsed < 0 && e < -AE.DEAD && blown < 0.3 * AE.BLOWN;
      if (!bright && !dark) { aeFresh = true; return false; }
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
    // narrow and too wide, settling on the wider; at most 30 times the base. The colour bar's labels follow.
    let coLn = 0, coGoal = 0, coFresh = true, coTries = 0, coLo = -Infinity, coHi = Infinity;
    const coOn = () => lookNow === 'co' && opt.coMode !== 'm1';
    function coAim(px, lnUsed) {
      let b = 0, w = 0;
      for (let i = 0; i < px.length; i += 4) { b += px[i + 1]; w += px[i + 2]; }
      if (coTries >= AE.TRIES || w <= 0) { coFresh = true; return false; }
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
    let accT = null, accN = 0, lastSig = [];
    let fadeT = 0, fstats = null;   // fstats: a running measurement, see diskFrameStats
    function draw() {
      drawOnce();
      // reduced motion: no frames follow, so the exposure is found now (measured with blocking reads, redrawn)
      for (let i = 0; reduce && i < 5 && W && !lost && ((aeOn() && !aeHeld()) || coOn()); i++) {
        aePass(); gl.readPixels(0, 0, AE_W, AE_H, gl.RGBA, gl.UNSIGNED_BYTE, aePx); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (aeOn()) { if (!aeAim(aePx, aeLn)) break; aeLn = aeGoal; } else { if (!coAim(aePx, coLn)) break; coLn = coGoal; }
        drawOnce();
      }
    }
    function drawOnce() {
      if (!W || lost) return;
      const d0 = fstats ? performance.now() : 0;
      // the planet's fade, in real time (so that it also completes while the model is paused); the step is at most 0.1 s,
      // since a paused model draws nothing until something changes and the first frame of a fade would otherwise jump
      // to its end
      const now = performance.now(), want = (opt.mode & 16) ? 1 : 0, dtR = fadeT ? Math.min(0.1, (now - fadeT) / 1000) : 0;
      fadeT = now;
      planetAmp = reduce ? want : want > planetAmp ? Math.min(want, planetAmp + dtR / planetFade) : Math.max(want, planetAmp - dtR / planetFade);
      const wantS = opt.slice ? 1 : 0;
      sliceU = reduce ? wantS : wantS > sliceU ? Math.min(wantS, sliceU + dtR / 1.5) : Math.max(wantS, sliceU - dtR / 1.5);
      // (a closed cut takes its new angle at once: the sweep shows the opening)
      cutA = reduce || sliceU <= 0 ? CUT_A[opt.cut] : toward(cutA, CUT_A[opt.cut], dtR, 0.9 * 4 / Math.PI);
      const wantA = opt.ann ? 1 : 0;
      annAmp = reduce ? wantA : wantA > annAmp ? Math.min(wantA, annAmp + dtR / 0.4) : Math.max(wantA, annAmp - dtR / 0.4);
      if (lookNow !== opt.look && (reduce || performance.now() - lookT0 >= 300)) lookNow = opt.look;
      const wantF = showField && lookNow === 'model' ? 1 : 0;
      fieldAmp = reduce ? wantF : wantF > fieldAmp ? Math.min(wantF, fieldAmp + dtR / 0.4) : Math.max(wantF, fieldAmp - dtR / 0.4);
      fieldG.setAttribute('opacity', fieldAmp.toFixed(3));
      COMP_BITS.forEach((b, i) => { compAmp[i] = toward(compAmp[i], opt.mode & b ? 1 : 0, dtR, 0.6); });
      modelAmp = toward(modelAmp, lookNow === 'model' ? 1 : 0, dtR, 0.4);
      msAmp = toward(msAmp, opt.ms ? 1 : 0, dtR, 0.6);
      asymAmp = toward(asymAmp, opt.asym ? 1 : 0, dtR, 0.6);
      marksAmp = toward(marksAmp, opt.marks ? 1 : 0, dtR, 0.4);
      wavesAmp = toward(wavesAmp, opt.waves ? 1 : 0, dtR, 0.6);
      if (planetAmp === want) planetFade = 1.5;
      snowNow();
      const wantE = (opt.mode & 32) ? 1 : 0;
      envAmp = reduce ? wantE : wantE > envAmp ? Math.min(wantE, envAmp + dtR / 1.5) : Math.max(wantE, envAmp - dtR / 1.5);
      camera();
      cutFrame();
      envVis = envAmp * ss(110, 190, Math.hypot(cam[0], cam[1], cam[2]));
      const magVis = lookNow === 'co' ? 0 : 1 - ss(1, MAG.SHOW, Math.hypot(cam[0], cam[1], cam[2]));   // the magnetosphere
      planetUniforms();
      const pPos = planetPos(time), pVis = planetAmp * (1 - ss(1.5, 5, Math.hypot(cam[0] - pPos[0], cam[1] - pPos[1], cam[2] - pPos[2])));
      wakeAmp = planetAmp * (lookNow === 'model' ? wakeFor(cam) : 1);
      // the automatic exposure toward its goal (1 when off), eased; held through an outburst and a change of look
      if (!aeOn()) { aeGoal = 0; aeFresh = true; }
      if (!aeHeld()) { aeLn += (aeGoal - aeLn) * (reduce ? 1 : Math.min(1, dtR / 0.15)); if (Math.abs(aeGoal - aeLn) < 1e-3) aeLn = aeGoal; }
      if (!coOn()) { coGoal = 0; coFresh = true; }
      coLn += (coGoal - coLn) * (reduce ? 1 : Math.min(1, dtR / 0.15)); if (Math.abs(coGoal - coLn) < 1e-3) coLn = coGoal;
      // (the star itself keeps its brightness: far brighter than the disk, it stays white whatever the exposure)
      const dS = Math.hypot(cam[0], cam[1], cam[2]), lg = LOOK_GAIN[lookNow] ? Math.pow(LOOK_GAIN[lookNow], ss(8, 60, dS) * (1 - ss(120, 300, dS))) : 1;
      const expo = opt.exposure * lg * Math.exp(aeLn) * Math.pow(burstL(), 0.6) * lookDip(), starL = Math.pow(burstL(), 0.7) * LOOK_STAR[lookNow] / (Math.exp(aeLn) * lg);
      if (envVis > 0) makeEnv3();
      // the volume, with the FULL program while the slice or the planet close up shows (the usual one stands in while
      // FULL is still compiling)
      const F = sliceU > 0 || opt.slice || pVis > 0 || envVis > 0 || magVis > 0 || lookNow !== 'model' ? fullProgram() : null, U = F ? F.U : U0;
      // a still picture (see ACC_MAX): the same state as the last frame, drawn by the same program
      const sig = [time, ...cam, ...basis.f, rW, rH, canvas.width, opt.steps, opt.fov, opt.seed, starL, LOOKS[lookNow], rSn, opt.mode, ...compAmp,
        sliceU, cutA, SLICE_Q[opt.sliceQ] || 0, gapDepth, wakeAmp, wavesAmp, pVis, envVis, magVis, msAmp, asymAmp, CO_MODES[opt.coMode], opt.coV, F ? 1 : 0, ...clumps.flatMap((c) => [c.R, c.phi, c.t0, c.amp]), ...vapor.flatMap((v) => [v.amp, v.t0]), coLn, expo];
      // (a new view: the exposure is measured afresh, with its moves counted anew; a new exposure or CO range: measured again)
      const ne = sig.length - 2, viewNew = sig.length !== lastSig.length || sig.some((v, i) => i < ne && v !== lastSig[i]);
      if (viewNew || sig[ne] !== lastSig[ne] || sig[ne + 1] !== lastSig[ne + 1]) { accN = 0; aeFresh = false; coFresh = false; }
      const key = [Math.round(10 * Math.log(Math.hypot(...cam))), Math.round(20 * camEl), Math.round(20 * camAz), ...panV.map((v) => Math.round(10 * v / camD)), lookNow, opt.mode, opt.slice ? opt.cut + opt.sliceQ : '', follow, msAmp, W, Hh, opt.coMode, opt.coV].join();
      if (key !== aeKey) { aeKey = key; aeTries = 0; aeLo = -Infinity; aeHi = Infinity; coTries = 0; coLo = -Infinity; coHi = Infinity; aeGen++; }
      lastSig = sig;
      const acc = accN;
      if (!acc) {
        drawWindMap(Math.round(ASYM_F_JS * asymSm() * 100) / 100);
        eddyPass();
        windPass();
        // the disk map for this moment and view (the footprints of the pixels depend on the camera)
        gl.useProgram(progDisk);
        gl.uniform1f(UD.uPlanetPhi, planetPhi(time));
        gl.uniform1f(UD.uWake, wakeAmp);
        gl.uniform1f(UD.uWakeX, wavesAmp);
        gl.uniform1f(UD.uTime, time);
        gl.uniform1f(UD.uSeed, opt.seed);
        gl.uniform3fv(UD.uCam, cam);
        gl.uniform1f(UD.uPixA, 2 * Math.tan(opt.fov / 2) / rH);
        gl.uniform2fv(UD.uAccK, accK());
        gl.bindFramebuffer(gl.FRAMEBUFFER, diskMapT.fb); gl.viewport(0, 0, diskMapT.w, diskMapT.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, accT.fb);
      gl.viewport(0, 0, rW, rH);
      gl.useProgram(F ? F.prog : prog);
      gl.uniform1f(U.uPlanet, gapDepth);
      gl.uniform3f(U.uTrap, trap.R, trap.filt, trap.s);
      gl.uniform4f(U.uGapRim, rim ? rim.R : 1e9, rim ? rim.th : 0, rim ? rim.end : 0, rim ? rim.h : 1);
      gl.uniform2f(U.uRes, rW, rH);
      gl.uniform1f(U.uTime, time);
      gl.uniform3fv(U.uCam, cam);
      gl.uniformMatrix3fv(U.uBasis, false, [...basis.r, ...basis.u, ...basis.f]);
      gl.uniform1f(U.uTanHalf, Math.tan(opt.fov / 2));
      gl.uniform1f(U.uRSnow, rSn);
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
      gl.uniform1i(U.uSteps, Math.round(opt.steps * (camD < 10 ? 2 : 1)));   // finer march when zoomed in
      gl.uniform1f(U.uSeed, opt.seed);
      gl.uniform1f(U.uPx, rW / W);
      gl.uniform4fv(U.uClump, clumps.flatMap((c) => [c.R, c.phi, c.t0, c.amp]));
      gl.uniform4fv(U.uVapor, vapor.flatMap((v) => [v.R, v.phi, v.t0, v.amp]));
      gl.uniform1i(U.uMode, (opt.mode & ~15) | COMP_BITS.reduce((m, b, i) => m | (compAmp[i] > 0 ? b : 0), 0));
      gl.uniform4fv(U.uComp, compAmp.map((v) => v * v * (3 - 2 * v)));
      gl.uniform1f(U.uMS, msAmp * msAmp * (3 - 2 * msAmp));
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
      gl.uniform3fv(U.uSliceN, basis.n);
      gl.uniform3fv(U.uSliceR, basis.r);
      gl.uniform1f(U.uSliceZ, SZ);
      gl.uniform3fv(U.uPlanetPos, pPos);
      gl.uniform1f(U.uPlanetVis, pVis);
      gl.uniform1f(U.uEnv, envVis);
      // frame acc of a still picture: R2 and golden-ratio sequences (none for the first), weighted 1/(acc + 1)
      gl.uniform3f(U.uJit, acc ? (acc * 0.7548777) % 1 - 0.5 : 0, acc ? (acc * 0.5698403) % 1 - 0.5 : 0, (acc * 0.618034) % 1);
      // the cut face at the screen's resolution (the same program and uniforms, see faceAt), drawn again when the picture
      // starts over (it does not depend on a still's jitter), before the volume (which leaves out what lies behind it
      // where it is opaque): one sample per pixel into faceA (unit 12, unbound while it is drawn into), then faceT (unit
      // 11, for SHOW_FS), four samples where the face changes from pixel to pixel
      const faceOn = !!F && opt.sliceQ !== 'none' && sliceU > 0.82 && lookNow === 'model';
      if (faceOn && !acc) {
        if (!faceT) {
          faceA = target(canvas.width, canvas.height, gl.RGBA8, gl.CLAMP_TO_EDGE); faceT = target(canvas.width, canvas.height, gl.RGBA8, gl.CLAMP_TO_EDGE);
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
      if (acc) { gl.enable(gl.BLEND); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA); gl.blendColor(0, 0, 0, 1 / (acc + 1)); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      accN = acc + 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(progShow);
      gl.uniform2f(uShowDev, canvas.width, canvas.height); gl.uniform1i(uShowFace, faceOn ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // the automatic exposure's measurements, one at a time: started on a frame drawn at the exposure's goal, read on a
      // later frame once the GPU has done it (reduced motion measures in draw instead)
      // (the same measurements set the CO line's range in its look)
      const aeNow = aeOn() && !aeHeld(), coNow = coOn();
      if (!reduce && (aeNow || coNow)) {
        if (aeSync && gl.clientWaitSync(aeSync, 0, 0) !== gl.TIMEOUT_EXPIRED) {
          gl.deleteSync(aeSync); aeSync = null;
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, aeBuf); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, aePx); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          if (aeGenUsed === aeGen) { if (aeNow) aeAim(aePx, aeLnUsed); else coAim(aePx, aeLnUsed); }
        }
        // (measured on the first frame of a picture, drawn without the jitter of a still's refinement, so that a state
        // gives the same measurements whichever way it was reached; a still being refined that still needs one starts over)
        if (!aeSync && (aeNow ? aeGoal === aeLn : coGoal === coLn)) {
          if (acc === 0) {
            aePass();
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, aeBuf); gl.readPixels(0, 0, AE_W, AE_H, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            aeSync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
            aeLnUsed = aeNow ? aeLn : coLn; aeGenUsed = aeGen;
          } else if (aeNow ? !aeFresh : !coFresh) accN = 0;
        }
      }
      const f0 = performance.now(), o0 = f0;
      drawField();
      drawMag();
      drawAcc();
      drawEnv();
      drawCoBar();
      fieldMs = performance.now() - f0;
      drawSlice();
      // snow line annotation, projected with the same camera; with the slice, only the half that is kept
      // (on a painted face the ice boundary is drawn instead)
      // (the label goes where the field lines leave room: of the ring's points on the screen, the one whose label box
      // covers fewest of the lines' visible samples, the lowest of those; the ring and its label go when the ring is
      // under 30 px across, or off the screen)
      let d = '', pen = false;
      const ringA = annAmp * (opt.sliceQ === 'none' ? 1 : 1 - ss(0.82, 1, sliceU)), ringOn = ringA > 0.002, pts = [];
      let x0r = Infinity, x1r = -Infinity;
      for (let i = 0; i <= 72 && ringOn; i++) {
        const a = i / 72 * Math.PI * 2, P = [rSn * Math.cos(a), rSn * Math.sin(a), 0];
        if (!kept(P)) { pen = false; continue; }
        const q = project(P);
        if (q[2] <= zN) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true;
        x0r = Math.min(x0r, q[0]); x1r = Math.max(x1r, q[0]);
        if (i < 72 && i % 3 === 0) pts.push(q);
      }
      const lt = ja() ? 'スノーライン' : 'snow line', lw = textW(lt), shown = x1r - x0r >= 30;
      let best = null, bestS = Infinity;
      for (const q of shown ? pts : []) {
        const bx = q[0] + 8, by = q[1] + 14;
        if (bx < 4 || bx + lw > W - 4 || by < 14 || by > Hh - 30) continue;   // (on the panel, clear of the scale bar)
        let n = 0;
        for (let k = 0; k < fieldPts.length; k += 2) { const x = fieldPts[k], y = fieldPts[k + 1]; if (x > bx - 3 && x < bx + lw + 3 && y > by - 13 && y < by + 4) n++; }
        const sc = n - 0.002 * q[1];   // (fewest lines, then the lowest)
        if (sc < bestS) { bestS = sc; best = q; }
      }
      ring.setAttribute('d', shown ? d + (sliceU > 0 ? '' : 'Z') : '');
      label.textContent = best ? lt : '';
      const aop = annAmp.toFixed(3);
      ring.setAttribute('opacity', ringA.toFixed(3)); label.setAttribute('opacity', ringA.toFixed(3));
      if (best) { label.setAttribute('x', best[0] + 8); label.setAttribute('y', best[1] + 14); }
      // the planet, named when it shows (close up)
      const pq = project(pPos), pa = ss(0.3, 0.6, pVis) * (kept(pPos) ? 1 : 0);
      plabel.textContent = pa > 0 && pq[2] > zN ? (ja() ? '惑星と周惑星円盤' : 'planet and its disk') : '';
      if (plabel.textContent) {
        const rc = 0.4 * PLANET.RH / pq[2] * Hh / (2 * basis.th);   // radius of the planet's disk on the screen (px)
        plabel.setAttribute('x', (pq[0] + 0.75 * rc + 10).toFixed(1)); plabel.setAttribute('y', (pq[1] - 0.35 * rc - 12).toFixed(1)); plabel.setAttribute('opacity', (pa * annAmp).toFixed(2));
      }
      const QN = { T: ['温度', 'temperature'], rho: ['ガスの密度', 'gas density'], tau: ['星の方向の光学的厚さ', 'optical depth toward the star'], layers: ['磁場とガスの結合の層', 'the layers of the coupling of field and gas'], none: ['', ''] }[opt.sliceQ] || ['', ''];
      const CON = { chan: ['チャンネルマップ(' + opt.coV.toFixed(2) + ' km/s)', 'a channel map at ' + opt.coV.toFixed(2) + ' km/s'], m1: ['平均の視線速度(モーメント 1)', 'its mean velocity (moment 1)'], m0: ['積分強度(モーメント 0)', 'its integrated intensity (moment 0)'] }[opt.coMode];
      const cutJa = opt.cut === 'quarter' ? '右手前の 4 分の 1 を切り取り(右の切り口を正面から見る)' : '星を通る鉛直な面で手前の半分を切り取り', cutEn = opt.cut === 'quarter' ? ' The near right quarter is cut away (its right face seen face-on)' : ' The near half is cut away along a vertical plane through the star';
      const LKD = { optical: ['可視光・近赤外線の散乱光で見た姿で、星の光を散乱する表層と円盤風が見えます。', ' Seen in scattered light (visible and near infrared): the surface and the wind scatter starlight.'],
        mir: ['中間赤外線で見た姿で、暖かい表層の熱放射が内側ほど明るく見えます。', ' Seen in the mid-infrared: the warm surface glows, brightest close in.'],
        mm: ['ミリ波で見た姿で、赤道面に沈んだ小石の熱放射が、惑星のギャップのすぐ外の環とともに見えます。', ' Seen at millimetre wavelengths: the pebbles at the midplane glow, with a ring just outside the planet\u2019s gap.'] }[lookNow];
      const desc = ja()
        ? '原始惑星系円盤(半径30 au)のモデルを立体的に描いた図。表層は暖かく、赤道面は冷たく、ダストが赤道面に沈み、約0.9 auのスノーラインの外側で氷をまとっています。' + (planetAmp > 0.5 ? '3 au に木星質量の惑星があり、ギャップを開けています。' : '') + (envVis > 0.5 ? '遠くからは、円盤を包むエンベロープと、軸に沿った空洞の明るい壁が見えます。' : '') + (opt.slice ? cutJa + '、切り口に' + (QN[0] ? QN[0] + 'を色で示しています。' : '切り口から円盤の内部を見た目のまま見せ、ガスの密度の等高線を重ねています。') : '') + (LKD ? LKD[0] : '') + (lookNow === 'co' ? '一酸化炭素の輝線で見た姿で、' + CON[0] + 'を示しています。' : '')
        : 'Volume rendering of a model protoplanetary disk (30 au in radius): warm surface layers, a cold midplane with settled dust, and a water snow line near 0.9 au.' + (planetAmp > 0.5 ? ' A Jupiter-mass planet at 3 au opens a gap.' : '') + (envVis > 0.5 ? ' From afar, the infalling envelope shows, with the bright walls of a cavity along the axis.' : '') + (opt.slice ? cutEn + '; the cut faces show ' + (QN[1] ? QN[1] + ' in colour.' : 'the inside of the disk as it looks, with contours of the gas density.') : '') + (LKD ? LKD[1] : '') + (lookNow === 'co' ? ' Seen in the line of carbon monoxide: ' + CON[1] + '.' : '');
      if (desc !== descEl.textContent) descEl.textContent = desc;
      const name = ja() ? '原始惑星系円盤のモデル(操作できる図)' : 'Model protoplanetary disk (interactive)';
      if (canvas.getAttribute('aria-label') !== name) { canvas.setAttribute('aria-label', name); keysEl.textContent = ja() ? KEYS_JA : KEYS_EN; }
      // scale bar: 1 au (or a round multiple) at the distance of the star (of the planet when following it)
      const o = project(camT), r1 = project(camT.map((v, i) => v + basis.r[i])), pxAu = o[2] > zN ? Math.hypot(r1[0] - o[0], r1[1] - o[1]) : 0;
      let Lb = 0.005; for (const c of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]) if (c * pxAu <= 150) Lb = c;
      // close to the star the clock runs slower (see clockK): said after the bar's length
      const ck = clockK(), ckT = ck < 0.97 ? (ja() ? '  時計 ×1/' : '  clock ×1/') + (1 / ck < 9.95 ? (1 / ck).toFixed(1) : String(Math.round(1 / ck))) : '';
      if (Lb !== sbLb) { if (sbLb && !reduce) { sbOld = sbLb; sbT = performance.now(); } sbLb = Lb; }
      const sbU = Math.min(1, (performance.now() - sbT) / 250), x0 = 18, y0 = Hh - 18;
      const bar = (g, L, a) => {
        const [hl, ln, tx] = g.children;
        if (L * pxAu > 320) a = 0;   // (the bar fading out after a big zoom would be drawn across the panel: not at all)
        for (const e of [hl, ln]) { e.setAttribute('x1', x0); e.setAttribute('x2', x0 + L * pxAu); e.setAttribute('y1', y0); e.setAttribute('y2', y0); }
        tx.textContent = pxAu > 0 && a > 0 ? L + ' au' + ckT : ''; tx.setAttribute('x', x0); tx.setAttribute('y', y0 - 6);
        g.setAttribute('opacity', (a * annAmp).toFixed(3));
      };
      bar(sgroup, Lb, sbU * sbU * (3 - 2 * sbU)); bar(sgroup2, sbOld, sbU < 1 ? 1 - sbU * sbU * (3 - 2 * sbU) : 0);
      if (fstats) {
        // the overlay's style and layout, forced here so that they are measured (otherwise done after the frame's script)
        const o1 = performance.now(); overlay.getBoundingClientRect(); const o2 = performance.now();
        fstats.draw.push(o1 - d0); fstats.over.push(o1 - o0); fstats.layout.push(o2 - o1);
      }
      box.dispatchEvent(new CustomEvent('diskframe', { detail: { time, years: time / 12 } }));
    }
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
    const busy = () => !!(flyV || flyT) || planetAmp !== ((opt.mode & 16) ? 1 : 0) || envAmp !== ((opt.mode & 32) ? 1 : 0) || sliceU !== (opt.slice ? 1 : 0) || (sliceU > 0 && cutA !== CUT_A[opt.cut])
      || annAmp !== (opt.ann ? 1 : 0) || lookNow !== opt.look || lookDip() < 1 || fieldAmp !== (showField && lookNow === 'model' ? 1 : 0) || !fadesDone()
      || (!aeHeld() && aeGoal !== aeLn) || coGoal !== coLn           // (the automatic exposure and the CO line's range on their way,
      || (aeOn() && !aeHeld() && !aeFresh) || (coOn() && !coFresh);  // or finding their levels)
    function frame(t) {
      if (!running) return;
      if (benching) { last = 0; lastRaw = 0; requestAnimationFrame(frame); return; }   // diskBench draws on its own
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      if (fstats) { fstats.t.push(t); dirty = true; if (t >= fstats.until) fsDone(); } else adapt(t);
      if (!paused) { time += dt * speed * clockK(); update(); dirty = true; }
      if (busy()) dirty = true;   // flights, fades and the sweep run in real time (see draw)
      if (dirty || (accN && accN < ACC_MAX)) { draw(); dirty = false; }
      requestAnimationFrame(frame);
    }
    const start = () => { if (!reduce && !running && !lost) { running = true; last = 0; requestAnimationFrame(frame); } };
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
      f.resolve({ frames: f.t.length, levelStep: f.levelStep, interval: { ...st(iv), over20: share(20), over33: share(33) }, draw: st(f.draw), overlay: st(f.over), layout: st(f.layout),
        paths: paths.length, pathsWithData: paths.filter((e) => e.getAttribute('d')).length, chars: paths.reduce((n, e) => n + (e.getAttribute('d') || '').length, 0),
        size: [rW, rH], scale: opt.scale, visible: document.visibilityState === 'visible' });
      dirty = true;
    }
    box.diskFrameStats = (seconds = 5, { levelStep = 1 } = {}) => new Promise((resolve) => {
      if (fstats) fsDone();
      lvStep = Math.max(1, Math.round(levelStep));
      fstats = { until: performance.now() + seconds * 1000, t: [], draw: [], over: [], layout: [], resolve, levelStep: lvStep };
      fstats.timer = setTimeout(fsDone, seconds * 1000 + 1000);   // (when no frames come)
      dirty = true;
    });
    // the gap's light tables (about 2 ms each), one per idle moment, so that a zoom or the tour never waits for one
    const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 3000 }) : (f) => setTimeout(f, 300);
    const prefetch = () => { if (gapLight.prefetch()) idle(prefetch); else idle(makeEnv3); };
    idle(prefetch);
    const stop = () => { running = false; };
    const addClump = (R, phi, age) => {
      const c = clumps.reduce((a, b) => (a.amp <= 0 ? a : b.amp <= 0 ? b : a.t0 < b.t0 ? a : b));
      c.R = R; c.phi = phi; c.t0 = time - (age || 0); c.amp = 1; c.crossed = R - 0.05 * (age || 0) < rSn;
    };

    // --- input: drag to rotate, wheel, pinch or keys to zoom, click to drop pebbles; touch as a map (see below) ---
    // closest approach: 2 au, or 0.25 au with the slice, where the structure of the inner disk (a few
    // hundredths of an au thick at 0.1 au) is to be seen
    const EL_MAX = 89 * Math.PI / 180;
    const DMAX = 600, dist0 = opt.dist, el0 = opt.el, az0 = opt.az, dmin = () => (follow ? 0.25 : MAG.DMIN);
    canvas.style.touchAction = 'none';   // (every touch on the picture is its own: see the touch handlers)
    canvas.tabIndex = 0;
    const clampEl = (v) => Math.min(EL_MAX, Math.max(-EL_MAX, v));   // (to 89 degrees: from straight above, the disk face-on)
    const touched = () => { dirty = true; if (reduce) draw(); };
    // tells the page that the view or the components changed from inside (keys, tour, easter eggs, a drag)
    const emitState = () => { if (box.diskState) box.dispatchEvent(new CustomEvent('diskstate', { detail: box.diskState() })); };
    const zoomBy = (f) => { opt.dist = Math.min(DMAX, Math.max(dmin(), opt.dist * f)); startFly(); touched(); };
    // the outburst (a click on the star, the B key): its clock is the model's, so a paused model starts again (the page's
    // button follows); none with reduced motion, where the clock does not run
    const burstNow = () => { if (reduce) return; if (paused) { paused = false; emitState(); } startBurst(); touched(); };
    // the planet grown from pebbles (the G key): the easter egg of three clumps near its orbit, from nothing if it was there
    const growPlanet = () => {
      if (opt.mode & 16) { opt.mode &= ~16; planetAmp = 0; box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: opt.mode } })); }
      seeds = [];
      for (let i = 0; i < 3; i++) { addClump(PLANET.A + 0.25 * (i - 1), planetPhi(time) + 0.6 * (i - 1), 0); seedPlanet(PLANET.A); }
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
    function clickAt(cx, cy) {
      const rect = canvas.getBoundingClientRect();
      const so = project([0, 0, 0]);
      if (so[2] > zN && Math.hypot(cx - rect.left - so[0], cy - rect.top - so[1]) < 14) { burstNow(); return; }
      const nx = ((cx - rect.left) / rect.width) * 2 - 1, ny = 1 - ((cy - rect.top) / rect.height) * 2;
      const th = Math.tan(opt.fov / 2), asp = W / Hh;
      const rd = [0, 1, 2].map((i) => basis.f[i] + th * (nx * asp * basis.r[i] + ny * basis.u[i]));
      const t = -cam[2] / rd[2]; if (t <= 0) return;
      const x = cam[0] + rd[0] * t, y = cam[1] + rd[1] * t, R = Math.hypot(x, y);
      if (R < 0.15 || R > 31 || !kept([x, y, 0]) || faceAlpha([x, y, 0]) > 0.5) return;
      addClump(R, Math.atan2(y, x), 0);
      ripple(cx - rect.left, cy - rect.top);
      seedPlanet(R);
      touched();
    }
    // The mouse and the pen: a drag turns (with Shift, or the middle or the right button, it moves the point looked at);
    // a click is clickAt.
    let panning = false, mousePtr = null;
    // (the right button pans: no menu over the picture)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), on);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || mousePtr !== null) return;
      mousePtr = e.pointerId;
      // (only a real pointer can be captured; events made by a script have none)
      if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
      takeOver(); stopTour(false);
      dragging = true; moved = false; px = e.clientX; py = e.clientY; panning = e.shiftKey || e.button === 1 || e.button === 2; if (e.button === 1) e.preventDefault();
    }, on);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== mousePtr || !dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (panning) panBy(dx, dy);
      else { azUser -= dx * 0.006; elUser = clampEl(elUser + dy * 0.006); }
      px = e.clientX; py = e.clientY;
      touched();
    }, on);
    const endMouse = () => { mousePtr = null; dragging = false; panning = false; };
    canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === mousePtr) { endMouse(); moved = true; } }, on);
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
    const TAP_MS = 300, TAP_PX = 10, DTAP_PX = 32;
    const tch = { pts: new Map(), last: null, t1: 0, t2: 0, moved: false, two: false, mode: '', g0: null, mid: null, tapT: 0, tapX: 0, tapY: 0, tapTimer: 0, hinted: false };
    // the first two fingers: their spread, angle and middle
    const twoOf = () => { const [a, b] = [...tch.pts.values()]; return { a, b, s: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: 0.5 * (a.x + b.x), my: 0.5 * (a.y + b.y) }; };
    // zoom by f toward the point under (cx, cy): the point looked at moves toward it, so that it stays under the finger
    const zoomAt = (cx, cy, f) => {
      const rect = canvas.getBoundingClientRect(), ox = cx - rect.left - W / 2, oy = cy - rect.top - Hh / 2;
      const g = Math.min(DMAX, Math.max(dmin(), opt.dist * f)) / opt.dist;
      panBy(-ox * (1 - g), -oy * (1 - g)); opt.dist *= g;
      startFly(); touched(); emitState();
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      tch.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
      takeOver(); stopTour(false);
      if (!tch.hinted) { tch.hinted = true; touchHint(); }
      // (taps are timed by the events' own times: a long frame does not stretch them)
      if (tch.pts.size === 1) { tch.t1 = e.timeStamp; tch.moved = false; tch.two = false; tch.last = { x: e.clientX, y: e.clientY }; }
      else if (tch.pts.size === 2) {
        // (the gesture is told from where both fingers are now)
        tch.two = true; tch.t2 = e.timeStamp; tch.mode = ''; tch.g0 = null;
        for (const q of tch.pts.values()) { q.x0 = q.x; q.y0 = q.y; }
      }
    }, on);
    canvas.addEventListener('pointermove', (e) => {
      const p = e.pointerType === 'touch' ? tch.pts.get(e.pointerId) : null; if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (tch.pts.size === 1) {
        if (!tch.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_PX) tch.moved = true;
        if (tch.moved) { panBy(p.x - tch.last.x, p.y - tch.last.y); tch.last = { x: p.x, y: p.y }; touched(); }
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
        tch.mid = [0.5 * (g.a.x0 + g.b.x0), 0.5 * (g.a.y0 + g.b.y0)];
      }
      if (tch.mode === 'tilt') elUser = clampEl(tch.g0.el + (g.my - tch.g0.my) * 0.006);
      else {
        opt.dist = Math.min(DMAX, Math.max(dmin(), tch.g0.d * tch.g0.s / Math.max(g.s, 1)));
        // (seen from below, the disk turns the other way on the screen)
        azUser = tch.g0.az + wrapPi(g.ang - tch.g0.ang) * (tch.g0.el < 0 ? -1 : 1);
        panBy(g.mx - tch.mid[0], g.my - tch.mid[1]); tch.mid = [g.mx, g.my];
      }
      touched();
    }, on);
    const touchEnd = (e, cancel) => {
      const p = e.pointerType === 'touch' ? tch.pts.get(e.pointerId) : null; if (!p) return;
      tch.pts.delete(e.pointerId);
      const now = e.timeStamp;
      if (tch.two) {
        // (a finger left after two: it goes on moving the point looked at, from where it is)
        if (tch.pts.size === 1) { const [r] = [...tch.pts.values()]; tch.last = { x: r.x, y: r.y }; tch.mode = ''; tch.g0 = null; return; }
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
      hint.textContent = ja() ? 'クリックしてからホイールでズーム(⌘/Ctrl+ホイールでも)' : 'Click the picture, then scroll to zoom (or \u2318/Ctrl + scroll)';
      hint.style.opacity = '1'; clearTimeout(hintT); hintT = setTimeout(() => { hint.style.opacity = '0'; }, 1600);
    };
    // (the first touch: how to move, as on a map)
    const touchHint = () => {
      hint.textContent = ja() ? '指 1 本で移動、2 本でズーム' : 'One finger moves, two zoom';
      hint.style.opacity = '1'; clearTimeout(hintT); hintT = setTimeout(() => { hint.style.opacity = '0'; }, 2200);
    };
    canvas.addEventListener('wheel', (e) => {
      if (document.activeElement !== canvas && !e.ctrlKey && !e.metaKey) { wheelHint(); return; }
      e.preventDefault(); stopTour(false); zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    }, { passive: false, signal: ac.signal });
    // The keys: arrows turn (with Shift they move the point looked at, by a tenth of the picture), + and - zoom, Home goes
    // back to the first view and to the star, C brings the point looked at back to the star (the view kept), space
    // pauses; 1 to 5 the views' angles (VIEWS, in step with the preview page's buttons: the distance and the point looked
    // at stay), P the planet, F the field lines, S the slice, A the annotations.
    const VIEWS = [[el0 * 180 / Math.PI, az0 * 180 / Math.PI, dist0], [10, -80, 85], [2, -80, 85], [89, -65, 100], [-14, -80, 85]];
    const PLANET_VIEW = { p: 1, el: 30, az: 160, d: 1.6, tx: 0, ty: 0, tz: 0 };
    // (Tab and the modifiers alone do not stop the tour: moving the focus is not taking over)
    const QUIET_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
    canvas.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!QUIET_KEYS.has(e.key)) stopTour(false);
      const k = e.key; let used = true;
      const view = (st) => { if (opt.slice) box.diskSlice(false); box.diskSet({ ...st, fly: 1 }); };
      if (e.shiftKey && k.startsWith('Arrow')) { const a = 0.1 * Hh; panBy(k === 'ArrowLeft' ? -a : k === 'ArrowRight' ? a : 0, k === 'ArrowUp' ? -a : k === 'ArrowDown' ? a : 0); startFly(); }
      else if (k === 'ArrowLeft') { azUser += 0.08; startFly(); } else if (k === 'ArrowRight') { azUser -= 0.08; startFly(); }
      else if (k === 'ArrowUp') { elUser = clampEl(elUser + 0.05); startFly(); } else if (k === 'ArrowDown') { elUser = clampEl(elUser - 0.05); startFly(); }
      else if (k === '+' || k === '=') zoomBy(0.8); else if (k === '-' || k === '_') zoomBy(1.25);
      else if (k === 'Home') { box.diskSet({ p: 0, slice: 0, el: el0 * 180 / Math.PI, az: az0 * 180 / Math.PI, d: dist0, tx: 0, ty: 0, tz: 0, fly: 1 }); }
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
      if (used) { e.preventDefault(); touched(); emitState(); }
    }, on);
    // adaptive render scale: when frames fall behind, render smaller; when they are comfortably on time,
    // work back up toward data-scale-max (the lines in the overlay are vector and unaffected)
    let fEma = 16.7, fN = 0, raiseLock = 0, lastRaw = 0;
    function adapt(t) {
      const dtRaw = lastRaw ? t - lastRaw : 16.7; lastRaw = t;
      if (paused) return;
      fEma += (dtRaw - fEma) * 0.1;
      if (++fN < 90) return;
      fN = 0;
      if (fEma > 24 && opt.scale > 0.4) { opt.scale = Math.max(0.4, opt.scale * 0.8); raiseLock = 20; resize(); }
      else if (fEma < 17.5 && opt.scale < opt.scaleMax && raiseLock-- <= 0) { opt.scale = Math.min(opt.scaleMax, opt.scale * 1.15); resize(); }
    }
    const watchers = [new ResizeObserver(resize), new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? start() : stop()))),
      new MutationObserver(() => { if (toastMsg && toast.style.opacity === '1') toast.textContent = ja() ? toastMsg[0] : toastMsg[1]; draw(); })];
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
    const lostEvent = (v) => box.dispatchEvent(new CustomEvent('disklost', { detail: { lost: v } }));
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();   // (so that the browser restores it)
      lost = true; running = false; stopTour(true); hush(); stillShown(true); lostEvent(true);
    }, on);
    canvas.addEventListener('webglcontextrestored', () => {
      const st = box.diskState();
      ac.abort(); watchers.forEach((w) => w.disconnect()); stopTour(true); hush();
      overlay.remove(); toast.remove(); hint.remove(); descEl.remove(); keysEl.remove(); clearTimeout(hintT); stillShown(false);
      try {
        init(box, canvas);
        box.diskSet({ ...st, fly: 0 });
        box.dispatchEvent(new CustomEvent('diskstate', { detail: box.diskState() }));
      } catch (err) {
        box.querySelectorAll(':scope > canvas, :scope > .disk-overlay').forEach((el) => el.remove());
        box.classList.add('disk-fallback'); console.error(err);
      }
      lostEvent(false);
    }, on);
    resize();
    box.diskSetTime = (t) => { if (isFinite(t)) { time = Math.min(TIME_MAX, Math.max(0, Number(t))); update(); draw(); } };
    box.diskBurst = () => { startBurst(); touched(); };
    // a clump of pebbles dropped as a click drops one (three near the planet's orbit grow it, see seedPlanet)
    box.diskAddClump = (R, phi, age) => { addClump(R, phi, age); if (!age) seedPlanet(R); draw(); };
    // controls for the preview page: view (degrees, au), components, time, state for links, snapshots
    // (to 0.01 degree and 0.001 au, so that a link restores the picture to within a pixel)
    const deg = (r) => Math.round(r * 18000 / Math.PI) / 100;
    // az is measured from the planet's azimuth while following it (p = 1)
    box.diskState = () => ({ el: deg(elUser), az: deg(azUser + (follow || reduce ? 0 : opt.spin * time)), d: Math.round(opt.dist * 1000) / 1000, mode: opt.mode, field: showField ? 1 : 0, speed, paused: paused ? 1 : 0, time, slice: opt.slice ? (opt.cut === 'quarter' ? 2 : 1) : 0, sq: opt.sliceQ, p: follow ? 1 : 0, ann: opt.ann ? 1 : 0, look: opt.look, ms: opt.ms ? 1 : 0, asym: opt.asym ? 1 : 0, marks: opt.marks ? 1 : 0, waves: opt.waves ? 1 : 0, coMode: opt.coMode, coV: opt.coV,
      tx: Math.round(panV[0] * 1e4) / 1e4, ty: Math.round(panV[1] * 1e4) / 1e4, tz: Math.round(panV[2] * 1e4) / 1e4 });
    // A state from outside (a link, the page, a script) is checked first: the numbers must be finite (a link copied with
    // text after it, or edited by hand, must not poison the picture: a NaN in the camera or the clock would blank it),
    // the distance and the speed positive, the components a mask of the six, the time within [0, TIME_MAX] (the shader's
    // clock is single precision); what fails is left as it is.
    const NUM_KEYS = ['slice', 'p', 'time', 'el', 'az', 'd', 'tx', 'ty', 'tz', 'mode', 'field', 'ann', 'ms', 'asym', 'marks', 'coV', 'speed', 'paused', 'fly'];
    const checked = (raw) => {
      const st = { ...raw };
      for (const k of NUM_KEYS) {
        if (!(k in st)) continue;
        const v = st[k], n = v == null || v === '' || typeof v === 'boolean' ? NaN : Number(v);
        if (isFinite(n)) st[k] = n; else delete st[k];
      }
      if (st.d != null && !(st.d > 0)) delete st.d;
      if (st.speed != null && !(st.speed > 0)) delete st.speed;
      if (st.speed != null) st.speed = Math.min(10, Math.max(0.1, st.speed));
      if (st.time != null) st.time = Math.min(TIME_MAX, Math.max(0, st.time));
      if (st.mode != null) st.mode = Math.round(st.mode) & 63;
      if (st.slice != null) st.slice = Math.min(2, Math.max(0, Math.round(st.slice)));
      for (const k of ['tx', 'ty', 'tz']) if (st[k] != null) st[k] = Math.min(PAN_MAX, Math.max(-PAN_MAX, st[k]));
      return st;
    };
    box.diskSet = (raw) => {
      const st = checked(raw || {});
      // the slice and following the planet first (they exclude each other), since they set how close the camera may come
      // slice: 0 closed, 1 the 1/2 cut, 2 the 1/4 cut
      if (st.slice != null) { const k = Number(st.slice); opt.slice = k > 0; if (k > 0) opt.cut = k === 2 ? 'quarter' : 'half'; if (opt.slice) follow = false; }
      if (st.p != null) { follow = !!Number(st.p); if (follow) opt.slice = false; }
      if (st.sq != null && own(SLICE_Q, st.sq)) opt.sliceQ = st.sq;
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
      touched();
    };
    box.diskView = (elevationDeg, azimuthDeg, distance) => box.diskSet({ el: elevationDeg, az: azimuthDeg, d: distance, p: 0 });
    box.diskPlanetView = () => box.diskSet({ ...PLANET_VIEW, fly: 1 });
    // back to the centre: the point looked at back to the star (the planet, when following it), the view as it is
    box.diskCenter = () => { box.diskSet({ tx: 0, ty: 0, tz: 0, fly: 1 }); emitState(); };
    // --- the tour: the highlights in turn, each with a short text, then back to the first view. Its first step brings
    // back the state the texts describe (the model's look; the gas, the surface, the pebbles, the wind and the planet;
    // the field lines, the annotations, the multiple scattering and the wind's asymmetry on, the marks off), and later
    // steps turn on what they show (the envelope). It stops when the visitor takes over (a drag, the wheel when it
    // zooms, a key but Tab and the modifiers) or asks; the page stops it at any other operation too. The page learns
    // of it from disktour events. ---
    const comps = (bits) => { if ((opt.mode & bits) !== bits) { box.diskSet({ mode: opt.mode | bits }); box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: opt.mode } })); } };
    const home = () => box.diskSet({ p: 0, el: VIEWS[0][0], az: VIEWS[0][1], d: VIEWS[0][2], tx: 0, ty: 0, tz: 0, fly: 1 });
    const TOUR = [
      { go: () => {
        if (opt.slice) box.diskSlice(false);
        const m = opt.mode | 31;
        box.diskSet({ look: 'model', field: 1, ann: 1, ms: 1, asym: 1, marks: 0, mode: m });
        box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: m } }));
        home();
      }, ms: 8000,
        ja: '原始惑星系円盤のモデル(半径 30 au)。星の光が反り返った表層を温め、赤道面は冷たいままです。表面からは、磁場に駆動された風が吹き出しています。',
        en: 'A model protoplanetary disk, 30 au in radius. Starlight warms its flared surface while the midplane stays cold. A magnetically driven wind leaves the surface.' },
      { go: () => { if (opt.slice) box.diskSlice(false); box.diskSet({ p: 0, el: 30, az: -65, d: 9, fly: 1 }); }, ms: 9000,
        ja: '内側の数 au に寄りました。約 0.9 au のスノーラインの外では、赤道面に沈んだ小石が氷をまとっています。3 au の惑星がギャップを開け、渦巻きの波を立てています。',
        en: 'Closer in, the inner few au: beyond the snow line near 0.9 au the pebbles settled at the midplane are icy, and a planet at 3 au opens a gap and raises spiral waves.' },
      { go: () => { if (opt.slice) box.diskSlice(false); box.diskSet({ p: 0, el: 22, az: -65, d: 0.15, fly: 1 }); }, ms: 11000,
        ja: '星のすぐ近く(0.15 au)。星の双極子磁場が円盤を 0.05 au で切り取り(内側は円盤のない磁気圏)、ガスは閉じた磁力線に沿って、2 枚の弧状のカーテンになって星へ落ちています(着地のときは秒速約 400 km)。着地点は弧状の熱いスポットになり、星と一緒に回ります。0.05〜0.08 au はダストのないガスの円盤です。ここでは時計を遅くしています。',
        en: 'Right next to the star (0.15 au). Its dipole field truncates the disk at 0.05 au (inside, the magnetosphere holds no disk); the gas falls onto the star along the closed field lines as two arc-shaped curtains (about 400 km/s at impact), landing in arcs of hot spots that turn with the star. Between 0.05 and 0.08 au the gas disk has no dust. The clock runs slower here.' },
      { go: () => { comps(16); if (opt.slice) box.diskSlice(false); box.diskPlanetView(); }, ms: 9500,
        ja: '3 au の木星質量の惑星です。ガスを押しのけてギャップを開け、まわりに周惑星円盤を持っています。後ろに明るく見えるのは、星の光を受けたギャップの外側の壁です。',
        en: 'A Jupiter-mass planet at 3 au. It pushes the gas aside into a gap and has its own circumplanetary disk; behind it, the outer wall of the gap is lit by the star.' },
      { go: () => box.diskSlice(true, 'T', 'half'), ms: 10000,
        ja: '星を通る断面です。色は温度で、星の光が届く表層(白い線 τ* = 1 より上)は熱く、内部は冷たいままです。水色の破線は氷の境界、矢印は円盤風の速さです。',
        en: 'A slice through the star, coloured by temperature: the layer reached by starlight (above the white line, tau* = 1) is hot and the interior cold. The dashed line is the ice boundary; the arrows show the wind.' },
      { go: () => box.diskSlice(true, 'layers', 'quarter'), ms: 12000,
        ja: '右手前の 4 分の 1 を切り取り、右の切り口を正面から見ています(左半分は切らずに残した円盤)。切り口は磁場とガスの結合で塗り分けました。紺がデッドゾーン(磁場が結合せず、乱流もない)、青がその上の層流の表層、琥珀色が表層降着の層、内側の朱色が熱電離して乱れた領域です。降着の層は、磁場が回転と同じ向きのとき片側(ここでは下)にできます。',
        en: 'The near right quarter cut away, its right face seen face-on (the left half of the disk left whole), coloured by how the field couples to the gas: the dead zone in navy (no coupling, no turbulence), the laminar surface above it in blue, the accretion layer in amber, and the turbulent, thermally ionized inner disk in red. With the field aligned with the rotation the accretion layer forms on one side (here below).' },
      { go: () => { comps(32); box.diskSlice(false); box.diskSet({ p: 0, el: 14, az: -65, d: 340, fly: 1 }); }, ms: 10000,
        ja: '遠くから見ると、母体の雲の名残(エンベロープ)が回転しながら円盤へ落ちてきます。軸に沿った空洞の壁が、星の光で明るく見えます。',
        en: 'From afar, the remains of the parent cloud (the envelope) fall onto the disk as they rotate; the walls of a cavity along the axis are lit by the star.' },
      { go: () => home(), ms: 6000, last: true,
        ja: 'ツアーはここまでです。ドラッグで回し、ボタンやキーで成分や断面を切り替えて、自由に見てください。',
        en: 'That is the tour. Drag to look around, and use the buttons or keys to switch components and the slice.' }
    ];
    let tour = null;
    const tourEvent = () => box.dispatchEvent(new CustomEvent('disktour', { detail: { on: !!tour, step: tour ? tour.i : -1 } }));
    function tourStep(i) {
      const st = TOUR[i];
      tour = { i, timer: setTimeout(() => (st.last ? stopTour(false) : tourStep(i + 1)), st.ms) };
      st.go(); say(st.ja, st.en, st.ms - 300); touched(); emitState(); tourEvent();
    }
    function stopTour(quiet) {
      if (!tour) return;
      clearTimeout(tour.timer); tour = null;
      if (!quiet) hush();
      tourEvent();
    }
    box.diskTour = (on) => { if (on) { stopTour(true); tourStep(0); } else stopTour(false); };
    // the cutaway for the page, the keys and the tour: diskSlice(on, sq, cut) with cut 'half' or 'quarter' (or 1, 2;
    // the last one used when omitted). Opening flies to a close view of the inner disk as the planes sweep in: low for
    // the 1/2 cut, where the face shows the layers (6 degrees, 2.4 au), higher for the 1/4 cut, which opens the interior
    // in depth (CUT_VIEW); a change of cut while open turns the planes and flies to the other view; closing flies back
    // to the view before as they sweep out.
    const CUT_VIEW = { half: { el: 6, d: 2.4 }, quarter: { el: 24, d: 3.4 } };
    let sliceBefore = null;
    box.diskSlice = (on, sq, cut) => {
      if (sq && own(SLICE_Q, sq)) opt.sliceQ = sq;
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
    box.diskSpeed = (x) => { speed = x; };
    box.diskZoom = (f) => zoomBy(f);
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
      benching = true;
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
        gl.deleteBuffer(pbo);
        const ok = gpu.filter((v) => !isNaN(v));
        return { gpu: r2(med(ok)), gpuMin: ok.length ? r2(Math.min(...ok)) : NaN, wall: r2(wall), cpu: r2(med(cpu)), field: r2(med(fld)),
          n: ok.length, disjoint, size: [rW, rH], scale: opt.scale, steps: Math.round(opt.steps * (opt.dist < 10 ? 2 : 1)) };
      } finally { benching = false; dirty = true; }
    };
    // the render scale of the volume (the canvas has the screen's pixels); without an argument, the scale now
    box.diskScale = (sc) => { if (sc == null) return opt.scale; opt.scale = sc; resize(); return opt.scale; };
    // draws until every flight, fade and sweep has finished (at most maxMs): for scripts and tests, and it works in a
    // hidden page too, where no animation frames come. Each frame is waited for (a pixel read back), so that frames do
    // not pile up on the GPU when they are slow.
    // (in two rounds: everything comes to rest, then the automatic exposure and the CO line's range start again from their
    // base and find their levels on the settled picture, so that a state's picture does not depend on the way it was
    // reached, nor on the frames of a flight or a sweep on the way: a link, a check, a still)
    const aeRestart = () => { aeLn = aeGoal = coLn = coGoal = 0; aeTries = coTries = 0; aeLo = coLo = -Infinity; aeHi = coHi = Infinity; aeFresh = coFresh = false; aeGen++; };
    box.diskSettle = async (maxMs = 5000) => {
      if (lost) return false;
      const mc = new MessageChannel(), px = new Uint8Array(4); let wake = null;
      mc.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
      const t0 = performance.now();
      for (let round = 0; round < 2; round++) {
        if (round === 1) aeRestart();
        for (;;) {
          draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          if (!busy() || performance.now() - t0 > maxMs) break;
          await new Promise((r) => { wake = r; mc.port2.postMessage(0); });
        }
      }
      dirty = true;
      return !busy();
    };
    box.diskSteps = (n) => { opt.steps = n; };
    // a PNG of the current frame: the volume plus the overlay (lines, snow line, scale bar); with { canvas: true } the
    // canvas it is drawn on instead (for checks: encoding a PNG takes a second or more in a background page)
    // ({ full: true }: at the render scale 1, the screen's resolution, whatever the adaptive scale is meanwhile)
    box.diskSnapshot = async (o = {}) => {
      if (lost) return null;   // (no picture without a context)
      const sc0 = opt.scale;
      if (o.full && opt.scale < 1) { opt.scale = 1; resize(); }
      fullWait = true;
      for (let i = 0, n = o.frames || ACC_SNAP; i < n; i++) draw();
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
      if (opt.scale !== sc0) { opt.scale = sc0; resize(); }
      if (o.canvas) return out;
      return new Promise((res) => out.toBlob(res, 'image/png'));
    };
  }
  // Panels narrower than 700 px keep the static picture: a finger drag would fight page scrolling,
  // and phone GPUs should not pay for the ray march.
  const phone = window.matchMedia('(max-width: 699px)').matches;
  // A panel with data-mobile opts in to WebGL on narrow screens (used by the preview page).
  // If setting up fails part way, the canvas and overlay come out again so the static picture shows.
  document.querySelectorAll('[data-disk3d]').forEach((box) => {
    if (phone && !('mobile' in box.dataset)) { box.classList.add('disk-fallback'); return; }
    try { init(box); } catch (e) { box.querySelectorAll(':scope > canvas, :scope > .disk-overlay').forEach((el) => el.remove()); box.classList.add('disk-fallback'); console.error(e); }
  });
})();
