// Volume rendering of a model protoplanetary disk (out to its edge at 8 au), drawn on the GPU.
//
// The structure follows an irradiated, magnetically accreting disk:
//   gas        Σ ∝ R^-1 out to a density cutoff at 8 au, vertically Gaussian with H/R = 0.03 (R/au)^1/4
//              (T_mid ∝ R^-1/2); the tapering edge lies in the shadow of the flared disk
//   rotation   Keplerian, Ω ∝ R^-3/2; turbulent structure is sheared by it into trailing spirals
//   heating    starlight grazes the flared surface and is absorbed where the optical depth toward
//              the star reaches unity, a few scale heights up; that thin skin is hot and bright,
//              while the midplane stays cool (T_mid = 150 K at 1 au), so the water snow line sits
//              near 1 au as in a magnetically accreting disk
//   dust       large grains settle into a thin layer at the midplane; they are icy where
//              T < 160 K, bare rock inside, with a modest pile-up of ice just outside the
//              snow line from re-condensing vapor
//   wind       a magnetically driven wind leaves the irradiated surface along the field lines of a
//              self-similar MHD wind solution, with its density and flow speed; stronger on one side
//              as for a field aligned with the rotation
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
// are read from two maps (see MAP_GLSL), so a step of the march costs a few texture fetches. The
// gas is drawn translucent (a real disk is opaque at visible wavelengths) so that the dust sheet and
// the snow line show through. Colour encodes temperature: amber where it is warm (inner disk,
// irradiated surface), blue where it is cold (outer midplane); icy dust is pale, rocky dust dark.
// Brightness follows the absorbed starlight with a softened falloff beyond 1 au and an asinh stretch.
// Clicking drops a clump of pebbles: it shears out, drifts inward and loses its ice inside
// the snow line; the vapor spreads outward and freezes again. Clicking the star sets off an FU Orionis
// outburst (see burstL); with the planet turned off, pebbles dropped near 3 au grow it back.
// Looks: the model's quantities as they are (the default), or as the disk would be seen at a wavelength: scattered
// light (optical, near-infrared), the warm surface's thermal emission (mid-infrared), the pebbles' thermal emission
// (millimetre). See uLook.
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
  // Inside the disk the radial and toroidal fields grow linearly with height (uniform currents), so the
  // line bends smoothly into the wind. Lines are labelled by their foot radius Rf at the midplane; below
  // the midplane they are mirrored.
  const MODEL = { R_IN: 0.08, H0: 0.03, R_OUT: 8.0, P_OUT: 6.0, LNTAU1: 8.5, TICE: 160.0, K_D: 1200.0, SD0: 0.012 };
  const G = (v) => Number.isInteger(v) ? v.toFixed(1) : String(v);   // a JS number as a GLSL float literal
  // A planet of Jupiter's mass (mass ratio q = 1e-3) on a circular orbit at 3 au, beyond the snow line. Its Hill radius
  // is a (q/3)^1/3 = 0.21 au. It opens a gap in the gas, a Gaussian dip in Σ, Σ (1 - depth e^-x²) with x = (R - a)/W,
  // of width (sigma) W = 1.8 Hill radii (FWHM 0.88 au = 4.2 Hill radii). Its depth is a choice for the picture and
  // depends on how close the camera is (DEPTH): 0.3 from afar, so that the usual view is not dominated by a dark ring,
  // and 0.98 close up, nearer what a Jupiter would clear in a disk this thin (H/R = 0.04 at 3 au: Σ_min/Σ_0 ~ 0.003 and
  // a width of ~0.8 a for alpha = 1e-3; Kanagawa et al. 2015, 2016). Everything that follows from the gap takes the
  // same depth: the starlight on it, the pebbles (filtered out of the gap, and collected at the pressure maximum just
  // outside it once the gap is deep enough to make one, see trapOf), the wind launched from it, the wake and the slice.
  // The wake, the spiral density wave the planet launches, follows Rafikov (2002) in shape; it is exaggerated (WAKE_A,
  // see wake in the disk map) and, like the gap, drawn weaker from afar (DEPTH.WAKE_FAR). Close up, the planet and its
  // circumplanetary disk (out to 0.4 Hill radii) show.
  const PLANET = (() => {
    const A = 3.0, Q = 1e-3, RH = A * Math.cbrt(Q / 3), W = 1.8 * RH;
    return { A, Q, RH, W, HP: MODEL.H0 * Math.pow(A, 0.25), PHI0: 2.4, WAKE_A: 3.5, WAKE_L: 0.6 };
  })();
  // the gap's depth: FAR when the camera is beyond D1 au from the planet's orbit (the circle R = a in the midplane;
  // the usual view is at 23 au), NEAR within D0, eased in between. The distance to the orbit rather than to the planet,
  // so that the depth does not change as the planet goes round (seen from near the star, as in the slice). The wake's
  // strength follows the same function, from WAKE_FAR of its full (exaggerated) amplitude afar to all of it near, so
  // that from the usual view its arms do not stand out as rings. Both are choices for the picture.
  const DEPTH = { FAR: 0.3, NEAR: 0.98, D0: 4, D1: 18, WAKE_FAR: 0.2 };
  const GL_R0 = 1.8, GL_DR = 7.6 / 127;   // radii of the table of starlight on the gap (see gapLightTables)
  // The envelope: the parent cloud, in solid-body rotation, collapses onto the star and the disk (Ulrich 1976). Each
  // parcel falls from rest far away on a parabolic orbit (zero energy) that keeps its angular momentum, sqrt(G M r_c)
  // sin(theta0) with theta0 its starting polar angle (z-component sqrt(G M r_c) sin^2 theta0), so it lands on the
  // midplane at r_c sin^2 theta0, inside the centrifugal radius r_c, here the edge of the disk (8 au):
  //   streamline  r = r_c sin^2 th0 / (1 - cos th / cos th0), with cos^3 th0 + cos th0 (r/r_c - 1) - (r/r_c) cos th = 0
  //   velocity    v_r = -sqrt(GM/r) (1 + cos th/cos th0)^1/2, v_th = sqrt(GM/r) (cos th0 - cos th) ((cos th0 + cos th) /
  //               (cos th0 sin^2 th))^1/2, v_phi = sqrt(GM/r) (sin th0/sin th) (1 - cos th/cos th0)^1/2
  //   density     rho = Mdot / (4 pi sqrt(G M r^3)) (1 + cos th/cos th0)^-1/2 (cos th/cos th0 + 2 cos^2 th0 r_c/r)^-1
  // (checked numerically: the velocities have zero energy and the parcel's angular momentum, are tangent to the
  // streamlines, and div(rho v) = 0, with the same mass flux through every sphere). The outflow (the disk wind) clears
  // a cavity along the axis: the streamlines that start within TH_CAV = 30 degrees of it are emptied (the cavity's
  // wall is itself a streamline, which reaches the disk at r_c sin^2 30 deg = 2 au). The envelope is drawn out to
  // R = 150 au, when the camera is farther than about 40 au. Its particles start at 60 au and move SPEED times faster
  // than the disk's clock (the fall from 60 au to the disk takes some 35 of the disk's years).
  const ENV = { R: 150, TH_CAV: Math.PI / 6, SPEED: 30, NS: 18 };
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
// radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf, at height h
vec2 fieldRP(float Rf, float h){
  float zb = zBase(Rf), hi = min(h, zb), q = hi * hi / zb;
  vec2 rp = vec2(Rf + 0.5 * A0 * q, 0.5 * B0 * q / Rf);
  if (h > zb) { vec4 t = tabAt((h - zb) / rp.x); rp = vec2(rp.x * t.x, rp.y + t.y); }
  return rp;
}
// foot radius of the line through (R, h): R(Rf) is monotonic at fixed h (nested lines, also where they
// turn back toward the axis), so bisect (once per point of the wind map, so to full precision)
float footRadius(float R, float h){
  float lo = 0.05, hi = max(R, 0.05);
  for (int i = 0; i < 24; i++) { float m = 0.5 * (lo + hi); if (fieldRP(m, h).x > R) hi = m; else lo = m; }
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
const float RB = 11.0, ZB = 9.0;        // marched cylinder (au): past the edge of the disk, up to the top of the drawn wind
`;
  const PLANET_GLSL = `
// the planet (see PLANET in the script): uPlanet is the depth of its gap (Σ is lowered by the factor 1 - uPlanet e^-x²;
// it depends on the camera's distance and fades in and out with the planet), uPlanetPhi its azimuth. uTrap: the radius
// of the pressure maximum outside the gap, the fraction of the pebbles filtered out of the gap and the strength of their
// trap at that maximum (see trapOf in the script).
uniform float uPlanet;
uniform float uPlanetPhi;
uniform float uWake;        // the wake's strength (0 to 1): the planet's presence times the strength for the camera's distance
uniform vec3 uTrap;
uniform vec3 uPlanetPos;
uniform float uPlanetVis;   // the planet and its disk shown close up (see planetLight)
const float R_CPD = ${G(+(0.4 * PLANET.RH).toFixed(4))};   // radius of the planet's disk, 0.4 Hill radii
const float A_P = ${G(PLANET.A)}, GAP_W = ${G(+PLANET.W.toFixed(5))}, HP = ${G(+PLANET.HP.toFixed(5))};
const float WAKE_A = ${G(PLANET.WAKE_A)}, WAKE_L = ${G(PLANET.WAKE_L)};
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
// in units of the local wavenumber.
const float LIFE = 1.5, AGE0 = 0.25;
vec3 turb(float lnR, float phi, float Om, float fp, float seed, bool fine, float time, vec2 cells){
  float b = log(LIFE / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b));
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
// Strength of the turbulent structure: strong in the thermally ionized innermost disk (MRI-active inside
// ~0.3 au), weak across the dead zone, modest again in the outer disk
float turbAmp(float R){ return 1.4 * (1.0 - smoothstep(0.2, 0.5, R)) + 0.3 + 0.4 * smoothstep(2.0, 5.0, R); }
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
const float LNR_MIN = ${G(Math.log(0.05))}, LNR_SPAN = ${G(Math.log(11.5 / 0.05))};   // disk map: R from 0.05 to 11.5 au
const float LNW_MIN = ${G(Math.log(0.04))}, LNW_SPAN = ${G(Math.log(15.0 / 0.04))};   // wind map: r from 0.04 to 15 au
const float RHO_B = ${G(Math.exp(-MODEL.LNTAU1) / (Math.sqrt(2 * Math.PI) * MODEL.H0))};   // gas density at the irradiation surface at 1 au
const float CHI_C = 0.03, WIND_BLEED = 0.03;   // wind density: held below CHI_C, fading into the disk below the base (units of r0)
const float LNE_MIN = ${G(Math.log(0.5))}, LNE_SPAN = ${G(Math.log(ENV.R / 0.5))};   // envelope map: r from 0.5 au to ENV.R
`;
  const DISKMAP_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uMapRes;   // texels along ln R and φ
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
// one 1.2 au farther in at 2 au. Returns the relative excess of the gas density on the crest: WAKE_A (3.5) next to the
// planet (at most about 3 at the edge of the gap), decaying over WAKE_L (0.6 a) away from it, out to 0.45 a and 2.3 a:
// exaggerated (a Jupiter-mass planet raises crests of order unity near it) so that the arms read as waves. The crest is a scale
// height wide, broadening as the wave travels (its shock widens), and widened further (and lowered, keeping its
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
  return uWake * WAKE_A * exp(-ax / WAKE_L) * smoothstep(0.03, 0.10, ax) * smoothstep(0.42, 0.55, x) * (1.0 - smoothstep(2.0, 2.5, x))
       * w * inversesqrt(wf2) * exp(-d * d / wf2);
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
  vec3 n = turb(lnR, phi, Om, fp, uSeed, true, uTime, CELLS) * A;
  // cast shadows: the optical depth toward the star builds up mostly over the last part of the ray
  // (R' = t R, t from 0.5 to 1, weighted by the smooth profile), where the turbulence raises or lowers
  // the density. The surface behind a crest is shaded, behind a trough it is lit more strongly.
  float aR = LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R);
  float dtau = 0.0, rPrev = 1.0;
  for (int k = 1; k <= 5; k++) {
    float t = 1.0 - 0.1 * float(k), tm = t + 0.05;
    float r = exp(-1.25 * log(t) - aR * (inversesqrt(t) - 1.0));          // tau*(t) / tau*(1) along the ray
    float At = turbAmp(R * tm);
    float f = exp(1.6 * At * turb(lnR + log(tm), phi, Om * pow(tm, -1.5), fp, uSeed, false, uTime, CELLS).x - 0.08 * At * At);
    dtau += (f - 1.0) * (rPrev - r); rPrev = r;
  }
  float nd = turb(lnR, phi, Om, fp, uSeed + 11.0, false, uTime, CELLS).x;
  // the planet's wake raises the gas, the pebbles (which collect in its pressure crests, a little less) and, more, the
  // surface that faces the star; the raised crest shades the surface just outside it, so each arm is a bright crest
  // with a darker trough beyond
  float wk = wake(R, phi, fp);
  float sh = exp(-2.0 * max(0.0, wake(R - H0 * pow(R, 1.25), phi, fp) - wk));
  // gas density, skin brightness (slopes facing the star catch more light), pebble surface density, starlight on the
  // gap and beyond
  fragColor = vec4(exp(1.6 * n.x - 0.08 * A * A) * (1.0 + wk), max(0.0, 1.0 + 0.5 * n.y + RELIEF * n.z) * exp(-dtau) * (1.0 + 2.0 * wk) * sh,
                   max(0.0, 1.0 + A * nd) * (1.0 + 0.8 * wk), gapLight(R));
}`;
  const WINDMAP_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uMapRes;
${CONST_GLSL}
${FIELD_GLSL}
${MAP_GLSL}
void main(){
  float r = exp(LNW_MIN + gl_FragCoord.x / uMapRes.x * LNW_SPAN), th = gl_FragCoord.y / uMapRes.y * 0.5 * PI;
  float R = r * cos(th), h = r * sin(th);
  float Rf = footRadius(R, h), zb = zBase(Rf), r0 = Rf + 0.5 * A0 * zb;
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
  fragColor = vec4(log(r0), fieldRP(Rf, h).y, tabAt(max(chi, 0.0)).z, lnrho);
}`;

  // The volume. Two programs are made from it: the usual one, and FULL (defined) with the slice and the planet seen
  // close up (and the envelope), which costs registers in the march even when unused; FULL is compiled in the
  // background and used only while one of those shows.  // The envelope map, drawn once on (ln r, θ) (θ the angle above the midplane): ln of the envelope's density (Ulrich
  // 1976, see ENV; 1 at r_c on the midplane far out), with the cavity along the axis and a fade at the outer edge, and
  // its column from the star (from 0.5 au) out to this point along the same direction, which dims the starlight.
  const ENVMAP_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uMapRes;
${CONST_GLSL}
${MAP_GLSL}
const float TH_CAV = ${G(+ENV.TH_CAV.toFixed(5))}, ENV_R = ${G(ENV.R)};
float cbrt(float v){ return sign(v) * pow(abs(v), 1.0 / 3.0); }
// ln of the density at r (au), mu = cos of the polar angle
float envLnRho(float r, float mu){
  float x = r / R_OUT;                         // r in units of r_c
  // cos theta0 of the streamline through this point: the root in [mu, 1] of m^3 + (x - 1) m - x mu = 0 (one real root
  // for x > 1, Cardano; three for x < 1, the largest; then two Newton steps)
  float pp = x - 1.0, q = -x * mu, D = 0.25 * q * q + pp * pp * pp / 27.0, m;
  if (D > 0.0) { float sD = sqrt(D); m = cbrt(-0.5 * q + sD) + cbrt(-0.5 * q - sD); }
  else { float pn = min(pp, -1e-6); m = 2.0 * sqrt(-pn / 3.0) * cos(acos(clamp(1.5 * q / pn * sqrt(-3.0 / pn), -1.0, 1.0)) / 3.0); }
  for (int i = 0; i < 2; i++) m -= (m * m * m + pp * m + q) / max(3.0 * m * m + pp, 1e-4);
  float mu0 = clamp(m, max(mu, 1e-4), 1.0);
  // density, with the pile-up where the streamlines meet at r_c on the midplane held finite
  float lnrho = -1.5 * log(x) - 0.5 * log(1.0 + mu / mu0) - log(max(mu / mu0 + 2.0 * mu0 * mu0 / x, 0.05));
  // the cavity: streamlines that start within TH_CAV of the axis are emptied (a little gas is left in it)
  float open = 1.0 - smoothstep(cos(TH_CAV + 0.08), cos(TH_CAV - 0.08), mu0);
  return lnrho + log(max(mix(0.015, 1.0, open) * (1.0 - smoothstep(0.65 * ENV_R, ENV_R, r)), 1e-30));
}
void main(){
  float lnr = LNE_MIN + gl_FragCoord.x / uMapRes.x * LNE_SPAN, mu = sin(gl_FragCoord.y / uMapRes.y * 0.5 * PI);
  // the column from 0.5 au, integrated in ln r (48 steps, trapezoid)
  float N = 0.0, f0 = exp(envLnRho(exp(LNE_MIN), mu) + LNE_MIN), dl = (lnr - LNE_MIN) / 48.0;
  for (int i = 1; i <= 48; i++) { float l = LNE_MIN + float(i) * dl, f1 = exp(envLnRho(exp(l), mu) + l); N += 0.5 * (f0 + f1) * dl; f0 = f1; }
  fragColor = vec4(envLnRho(exp(lnr), mu), N, 0.0, 0.0);
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
uniform vec4 uClump[6];
uniform vec4 uVapor[4];
uniform int uMode;      // bit mask of the components drawn: 1 gas body, 2 surface skin, 4 pebble sheet, 8 wind
uniform vec4 uComp;     // their brightness as they fade in or out (gas, skin, pebbles, wind; 1 when on)
uniform sampler2D uDiskMap;
uniform sampler2D uWindMap;
uniform sampler2D uEnvMap;
uniform float uEnv;     // the envelope: its visibility (it fades in with the distance of the camera)
// The slice: a vertical plane through the star (containing the axis) facing the camera. The half of space
// toward the camera is cut away, and the cut face shows a quantity in false colour (uSliceQ: 0 none, only
// the cut, 1 temperature, 2 gas density, 3 optical depth toward the star). uSliceN is the horizontal normal
// toward the camera, uSliceR the horizontal direction to the right in the plane; uSliceZ scales heights on
// the face (1: true proportions; a stretch would also need the march behind in stretched coordinates).
// uSliceOff: the plane's distance from the star toward the camera; it sweeps in from the edge of the drawn
// region when the slice opens and back out when it closes. During the sweep the face is the plain cut (the
// quantity's colours would make large flat walls of the chords through the outer disk); they fade in, by
// uSliceFace, as the plane reaches the star.
uniform int uSlice;
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
// Brightness of the wind per unit of its extinction (K_G rho) and of the starlight reaching it, chosen so
// that the wind shows from the side without veiling the disk. Close to the disk (camera within about
// 6-18 au of the star) it is dimmed to WIND_NEAR, since there the paths through the wind near the star
// are long and its forward-scattered light would hide the amber of the irradiated surface.
const float G_WIND = 200.0, WIND_NEAR = 0.35;
const float WIND_LOW = 0.35;                  // the lower side of the wind relative to the upper
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
// toward the star (ENV_KSTAR per unit of the map's column, so that it reaches a few tens of au into the envelope
// next to the cavity and less toward the midplane): the cavity's walls are lit, as in images of young stars still in
// their envelopes. Seen along the line of sight it is kept translucent, as the disk is: its density is scaled by
// ENV_RHO relative to the gas density unit of the disk (the midplane at 1 au) and it absorbs little. envLight returns
// the emission and the extinction per unit length, the same inside the marched cylinder and outside it.
const float ENV_RHO = 4e-4, G_ENV = 70.0, ENV_KSTAR = 1.0;
const vec3 ENV_COL = vec3(0.55, 0.66, 0.95);
const int ENV_N = 24;                   // samples of the envelope in front of and behind the marched cylinder
void envLight(vec3 p, vec3 rd, out vec3 em, out vec3 ex){
  float r = max(length(p), 0.5), R = length(p.xy);
  vec2 m = texture(uEnvMap, vec2((log(r) - LNE_MIN) / LNE_SPAN, atan(abs(p.z), R) / (0.5 * PI))).rg;
  float re = ENV_RHO * uEnv * exp(m.x);
  em = G_ENV * K_G * re * smoothstep(0.13, 0.2, abs(p.z) / max(R, 1e-3)) * exp(-ENV_KSTAR * m.y) / (1.0 + r * r / 225.0) * phaseGas(dot(p, -rd) / r) * ENV_COL;
  ex = K_G * re * EXT;
}

// the disk map at (ln R, φ): factors of the gas density, the skin brightness, the pebble density and the starlight
vec4 diskMap(float lnR, float phi){ return texture(uDiskMap, vec2((lnR - LNR_MIN) / LNR_SPAN, phi / TAU + 0.5)); }
// the wind map at (R, |z|): ln of the radius r0 where the field line leaves the disk, its azimuth relative to
// the foot, the travel time of the gas from the base, ln of the gas density
vec4 windMap(float R, float az){
  return texture(uWindMap, vec2((0.5 * log(R * R + az * az) - LNW_MIN) / LNW_SPAN, atan(az, R) / (0.5 * PI)));
}
// The disk ends in a density cutoff at R_OUT (exp(-(R/R_OUT)^P_OUT)); its tapering edge lies in the shadow of
// the flared disk, so the light fades with the surface.
float Sigma(float R, float lnR){ return exp(-lnR - cutOut(R) + gapLn(R)) * smoothstep(R_IN * 0.8, R_IN * 1.3, R); }
// Starlight absorbed per unit area of the surface, L β / 4πR², with β the grazing angle of the
// irradiation surface z_s = H sqrt(2 a), a = ln τ* at the midplane. Where the density cutoff brings the
// surface down, β drops to zero: the edge lies in the shadow of the disk's crest. Shown with the true
// R^-2 falloff inside 1 au, easing to R^-1.1 outside (scattered-light images are often scaled by R²
// for the same reason).
// With the planet's gap the starlight is redistributed: the inner rim shades the gap, and the light that passes over
// it falls on the outer wall and beyond. That factor comes from ray tracing (the disk map's fourth channel).
float Eabs(float R, float lnR, float H){
  float cut = cutOut(R), a = max(LNTAU1 - 1.25 * lnR - cut, 1.0);
  float beta = max(H * sqrt(2.0 * a) / R * (0.25 - (0.625 + 0.5 * P_OUT * cut) / a), 0.0) + 0.004 / R;
  return beta / 0.022 * pow(1.0 + R, 0.9) / (0.66 * (R * R + 0.01)) * smoothstep(R_IN * 0.85, R_IN * 1.5, R);
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

// x = ln of the optical depth toward the star; the irradiation surface is x = 0
float lnTauStar(vec3 p){
  float R = max(length(p.xy), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR);
  return clamp(LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R) - 0.5 * p.z * p.z / (H * H), -30.0, 30.0);
}

// Streaks in the wind: the gas carries the turbulent structure of the disk surface from where and when it
// was launched, so clumps rise at the flow speed, turn with their field lines and are replaced as the
// disk's structure is (finite lifetimes, so they do not wind up). For the picture the cells are larger
// than the disk's (WIND_CELLS; the march resolves little finer than that across the wind) and the contrast
// is WIND_TURB times that of the disk gas at the foot. q = (ln r0, azimuth of the foot at the launch,
// travel time in 1/Omega(r0)); dq is how far q moved over the last step of the march: structure finer
// than a step is faded, so that it does not turn into noise. Lognormal with mean 1.
const vec2 WIND_CELLS = vec2(12.0, 4.0);
const float WIND_TURB = 2.0;
float windTurb(vec3 q, vec3 dq){
  float k = max(max(3.0 * WIND_CELLS.y * dq.x, WIND_CELLS.x / TAU * dq.y), dq.z / LIFE);   // cells crossed per step (sheared about threefold radially)
  float f = 1.0 - smoothstep(0.25, 0.5, k);
  if (f <= 0.0) return 1.0;
  float Om = OMEGA0 * exp(-1.5 * q.x), A = WIND_TURB * turbAmp(exp(q.x));
  float n = turb(q.x, q.y, Om, 0.0, uSeed + 23.0, false, uTime - q.z / Om, WIND_CELLS).x;
  return exp(f * (1.6 * A * n - 0.06 * A * A));
}

// One step of the ray march, from the previous sample (with ln τ* = xPrev) to p over a length ds.
// Returns emission and extinction per unit length for the gas and the wind, and the emission of the
// irradiated skin integrated over the step (it is far thinner than a step, so it is integrated
// analytically through the profile of absorbed starlight).
void sampleDisk(vec3 p, vec3 rd, float xPrev, float ds, inout vec3 wq, out vec3 em, out vec3 ex, out vec3 skin, out float x){
  em = vec3(0.0); ex = vec3(0.0); skin = vec3(0.0);
  float R = max(length(p.xy), 1e-3), lnR = log(R);
  float H = H0 * exp(1.25 * lnR);
  float z = p.z, az = abs(z), zh = z / H;
  float gl = gapLn(R), cut = cutOut(R);
  x = clamp(LNTAU1 - 1.25 * lnR - cut + gl - 0.5 * zh * zh, -30.0, 30.0);
  if (R < R_IN * 0.7) { wq = vec3(99.0); return; }

  if (max(x, xPrev) > -14.0) {
    float phi = atan(p.y, p.x);
    float Tm = TICE * sqrt(uRSnow / R), Ts = 2.8 * Tm;
    vec4 dm = diskMap(lnR, phi);
    float E = Eabs(R, lnR, H) * dm.a;
    // the irradiated skin: absorbed starlight j = E |d e^-τ* / dz|, integrated exactly for x varying
    // linearly over the step. The surface is corrugated by the turbulence; slopes facing the star
    // catch more light, and crests cast shadows (both in the disk map).
    bool atSkin = max(x, xPrev) > -4.5 && min(x, xPrev) < 2.2;
    if (atSkin && (uMode & 2) != 0) {
      float dx = x - xPrev, xm = 0.5 * (x + xPrev);
      float P = abs(dx) > 1e-3 ? (exp(-exp(xPrev)) - exp(-exp(x))) / dx : exp(xm - exp(xm));
      // seen by scattered starlight (near-isotropic grains); the colour stays that of the temperature
      float mu = dot(p, -rd) / max(length(p), 1e-3), base = G_SKIN * E * az / (H * H) * ds * P * dm.g;
      skin = base * phaseDisk(mu) * tcolor(Ts);
#ifdef FULL
      if (uLook == 1) skin = base * G_OPT * hg(mu, G_OPT_HG) * SCAT_COL;
      else if (uLook == 2) skin = base * G_MIR * mirPlanck(Ts) * mirColor(Ts);
      else if (uLook == 3) skin = vec3(0.0);
#endif
      skin *= uComp.y;
    }
    // gas with small grains: translucent, glowing with its density in the colour of its temperature (cold
    // midplane; warm only inside the snow line)
    float rho = exp(-lnR - cut + gl - 0.5 * zh * zh) * smoothstep(R_IN * 0.8, R_IN * 1.3, R) / (2.5066 * H) * dm.r;   // Sigma / (sqrt(2 pi) H) e^(-z²/2H²)
    ex = K_G * rho * EXT;
    if ((uMode & 1) != 0) em = G_GAS * K_G * rho * tcolor(Tm) * uComp.x;
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
  // these densities is little. wq carries the coordinates of the streaks at the previous sample (99: none).
  vec3 q = vec3(99.0);
  bool windOn = true;
#ifdef FULL
  windOn = uLook <= 1;   // the wind and the envelope scatter starlight; no thermal emission is drawn for them
#endif
  if (x < 2.5 && windOn) {
    vec4 w = windMap(R, az);            // ln r0, azimuth relative to the foot, travel time, ln density
    // the grains that scatter and absorb: none where the gas left the disk inside about 2.5 R_IN (sublimated)
    float r0w = exp(w.x), r = length(p), rho = exp(w.w) * gapFactor(r0w) * (z > 0.0 ? 1.0 : WIND_LOW) * smoothstep(R_IN, 2.5 * R_IN, r0w);
    float lit = G_WIND * mix(WIND_NEAR, 1.0, smoothstep(6.0, 18.0, length(uCam))) * K_G * rho / (1.0 + r * r / 16.0)
              * phaseGas(dot(p, -rd) / max(r, 1e-3)) * exp(-exp(x));
    if (lit > 2e-4) {
      // the foot of the line, now at azimuth phi - w.y, has turned by w.z since this gas left it
      q = vec3(w.x, atan(p.y, p.x) - w.y - w.z, w.z);
      vec3 d = q - wq; d.y = mod(d.y + PI, TAU) - PI;
      float st = windTurb(q, wq.x > 50.0 ? vec3(0.0) : abs(d));
      if ((uMode & 8) != 0) em += lit * st * WIND_COL * uComp.w;
      ex += K_G * rho * st * EXT;
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
void envMarch(vec3 ro, vec3 rd, float t0, float t1, float jitter, inout vec3 col, inout vec3 tr){
  if (t1 <= t0) return;
  float ds = (t1 - t0) / float(ENV_N);
  for (int i = 0; i < ENV_N; i++) {
    vec3 em, ex; envLight(ro + rd * (t0 + (float(i) + jitter) * ds), rd, em, ex);
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
  float mu = abs(rd.z);
  float R = length(p.xy);
  if (R < R_IN || R > 11.0) return;
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
    float dt = uTime - c.z; float Rc = c.x - 0.05 * dt; if (Rc < R_IN) continue;
    float dphi = phi - (c.y + Om * dt); dphi = mod(dphi + PI, TAU) - PI;
    float w = 0.10 + 0.012 * dt;
    sc += c.w * 0.05 * (0.45 + 0.55 * ice) * exp(-pow((R - Rc) / 0.08, 2.0) - pow(dphi / w, 2.0)) * exp(-dt / 70.0);
  }
  sd += sc;
#ifdef FULL
  if (uLook != 0) {
    // millimetre: the pebbles' thermal emission (Rayleigh-Jeans, nearly thin); in scattered light and the
    // mid-infrared they lie inside the opaque disk
    if (uLook == 3) { float tm = K_MM * sd / max(mu, 0.15); col += tr * G_MM * (Tm / 100.0) * (1.0 - exp(-tm)) * MM_COL; tr *= exp(-tm); }
    else tr *= exp(-K_D * sd / max(mu, 0.03));
    return;
  }
#endif
  float tau = K_D * sd / max(mu, 0.03);
  float tmm = K_MM * sd / max(mu, 0.3);
  vec3 alb = mix(vec3(0.42, 0.20, 0.10) * 0.25, 0.9 * tcolor(min(Tm, 120.0)), ice);
  alb = mix(alb, vec3(0.85, 0.92, 1.0) * mix(0.35, 1.0, ice), sc / (sd + 1e-6));   // packed pebbles look paler
  vec3 src = G_DUST * alb * Eabs(R, lnR, H) * dm.a * (1.0 - exp(-tmm)) * (1.0 + PILE * (pile - 1.0));
  src *= uComp.z;
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
// Behind the inner rim of the planet's gap the ray toward the star crosses the rim's surface layers, so tau* there is
// at least that of the rim at the same angle above the midplane (the starlight below the rim's surface is absorbed at
// the rim): ln tau* = max(local, rim). uGapRim: the rim's radius and its angle z/R seen from the star, the radius
// where the outer wall comes out of its shadow, and H/R at the rim (a radius of 1e9 when the gap is too shallow to
// cast a shadow). Ray tracing the same gas puts the surface (tau* = 1) across the gap within 3% of this angle.
uniform vec4 uGapRim;
float xRim(float R, float az, float x){
  if (R <= uGapRim.x) return x;
  float th = az / R, xr = 0.5 * (uGapRim.y * uGapRim.y - th * th) / (uGapRim.w * uGapRim.w);
  return mix(x, max(x, xr), 1.0 - smoothstep(uGapRim.z, uGapRim.z + 0.5, R));
}
vec3 sliceQuantities(float Rs, float z, float phi){
  float R = max(abs(Rs), 1e-3), lnR = log(R), H = H0 * exp(1.25 * lnR), zh = z / H;
  float x = clamp(xRim(R, abs(z), LNTAU1 - 1.25 * lnR - cutOut(R) + gapLn(R) - 0.5 * zh * zh), -30.0, 30.0);
  float Tm = TICE * sqrt(uRSnow / R);
  vec4 w = windMap(R, abs(z));
  float rho = Sigma(R, lnR) / (2.5066 * H) * exp(-0.5 * zh * zh) * diskMap(lnR, phi).r
            + exp(w.w + gapLn(exp(w.x))) * (z > 0.0 ? 1.0 : WIND_LOW);
  return vec3(x > 0.0 ? Tm : 2.8 * Tm, log(max(rho, 1e-30) * ${G(Math.sqrt(2 * Math.PI) * MODEL.H0)}) / LN10, x);
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
// The cut face at pc: the colour (display values) and its opacity. The temperature is shown in the colours
// the volume uses for it, over the disk and its irradiated surface layer (up to tau* of about 0.01); the
// density (log10, from 10^-10 to 10^2.5 of the midplane at 1 au) over the disk and the wind; the optical
// depth (log10 tau* from -4 to 5) over the disk. The dust-free hole inside R_IN stays open.
vec4 sliceFace(vec3 pc){
  float R = length(pc.xy), z = pc.z / uSliceZ;   // the plane may be off the star while it sweeps
  vec3 q = sliceQuantities(R, z, atan(pc.y, pc.x));
  float hole = smoothstep(R_IN * 0.8, R_IN * 1.3, R);
  if (uSliceQ == 1) return vec4(0.92 * pow(tcolor(q.x), vec3(1.0 / 2.2)), smoothstep(-6.0, -4.5, q.z) * hole);
  if (uSliceQ == 2) return vec4(cmap((q.y + 10.0) / 12.5, false), smoothstep(-10.5, -9.5, q.y));
  if (uSliceQ == 3) return vec4(cmap((q.z / LN10 + 4.0) / 9.0, true), smoothstep(-4.5, -3.5, q.z / LN10) * hole);
  return vec4(0.0);
}

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float aspect = uRes.x / uRes.y;
  vec3 rd = normalize(uBasis[2] + uTanHalf * (uv.x * aspect * uBasis[0] + uv.y * uBasis[1]));
  vec3 ro = uCam;
  float pixA = 2.0 * uTanHalf / uRes.y;   // angular size of a render pixel

  // background: deep gradient with sparse faint stars
  vec3 sky = mix(vec3(0.0020, 0.0026, 0.0050), vec3(0.0040, 0.0056, 0.0130), smoothstep(-1.0, 1.0, uv.y));
  vec3 bg = stars(rd, pixA);

  // the star is a point: drawn with a small screen-space profile so it stays crisp at any size
  vec3 sv = vec3(dot(-ro, uBasis[0]), dot(-ro, uBasis[1]), dot(-ro, uBasis[2]));
  vec2 spx = (vec2(sv.x / (sv.z * uTanHalf * aspect), sv.y / (sv.z * uTanHalf)) * 0.5 + 0.5) * uRes;
  float dpx = length(gl_FragCoord.xy - spx) / uPx;
  vec3 starGlow = STARCOL * (40.0 * exp(-dpx * dpx / 1.2) + 0.4 * exp(-dpx / 2.0) + 0.02 / (1.0 + dpx * dpx / 50.0)) * uStar;
  float tStar = max(-dot(ro, rd), 0.0);

  // the slice: the ray enters the half that is kept at tCut, where it meets the cut face (rays that never
  // reach that half see only the sky); the face hides what lies behind it where it is opaque. While the plane
  // sweeps it may pass the camera: from inside the kept half nothing is cut in front, and a ray that leaves it
  // ends there.
  float tCut = 0.0, tEnd = 1e9;
  vec4 face = vec4(0.0);
#ifdef FULL
  if (uSlice != 0) {
    float sn = dot(rd, uSliceN), dc = dot(ro, uSliceN) - uSliceOff;
    if (dc > 0.0) {
      tCut = sn < -1e-6 ? dc / -sn : 1e9;
      if (tCut < 1e8 && uSliceFace > 0.0) { face = sliceFace(ro + rd * tCut); face.a *= uSliceFace; }
    } else if (sn > 1e-6) tEnd = -dc / sn;
  }
#endif

  vec3 col = vec3(0.0), tr = vec3(1.0);
  vec2 b = boundsCyl(ro, rd);
  b.x = max(b.x, tCut); b.y = min(b.y, tEnd);
  bool starDone = false;
#ifdef FULL
  // the planet and its disk, where the ray passes closest to it (1e9: not met, or done; their light is evaluated
  // only there, so that the march carries one number for them)
  float tPl = uPlanetVis > 0.0 ? dot(uPlanetPos - ro, rd) : 1e9;
  if (tPl <= tCut) tPl = 1e9;
#endif
  float tCross = abs(rd.z) > 1e-5 ? -ro.z / rd.z : -1.0;
  bool inside = b.y > b.x && face.a < 0.999;
  float jitter = fract(52.9829189 * fract(0.06711056 * gl_FragCoord.x + 0.00583715 * gl_FragCoord.y));   // interleaved gradient noise: finer grain than a hash
#ifdef FULL
  // the envelope: the part of its sphere in front of the cylinder (all of it when the ray misses the cylinder)
  vec2 be = vec2(1.0, 0.0);
  if (uEnv > 0.0 && uLook <= 1 && face.a < 0.999) {
    be = boundsSphere(ro, rd, ENV_R); be.x = max(be.x, tCut);
    envMarch(ro, rd, be.x, inside ? min(b.x, be.y) : be.y, jitter, col, tr);
  }
#endif
  // the midplane crossing may lie in the unlit outer disk, in front of or behind the marched part (or in
  // the half cut away)
  bool sheetDone = tCross <= tCut || face.a >= 0.999;
  if (!sheetDone && (!inside || tCross < b.x)) { sheet(ro + rd * tCross, rd, col, tr); sheetDone = true; }
  if (inside) {
    float t = b.x;
    vec3 p = ro + rd * t;
    float xPrev = lnTauStar(p);
    vec3 wq = vec3(99.0);
    for (int i = 0; i < 320; i++) {
      if (i >= uSteps || t > b.y || max(tr.r, max(tr.g, tr.b)) < 0.01) break;
      float R = length(p.xy);
      // steps follow the scale height in the disk and grow with height above it (only the wind is
      // there); beyond the lit region only the dust sheet matters, and it is crossed analytically
      float Hs = H0 * pow(max(R, 0.2), 1.25), az = abs(p.z);
      float ds = clamp(max(0.4 * Hs, (az > 4.5 * Hs ? 0.25 : 0.18) * az), 0.004, 0.4);
      if (i == 0) ds *= 0.25 + jitter;
      float t1 = t + ds;
      if (!sheetDone && t1 >= tCross) { sheet(ro + rd * tCross, rd, col, tr); sheetDone = true; }
      if (!starDone && t1 >= tStar) { col += tr * starGlow; starDone = true; }
#ifdef FULL
      if (t1 >= tPl) { vec4 pl = planetLight(ro, rd, aspect); col += tr * pl.rgb; tr *= exp(-pl.a); tPl = 1e9; }
#endif
      p = ro + rd * t1;
      vec3 em, ex, sk; float x;
      sampleDisk(p, rd, xPrev, ds, wq, em, ex, sk, x);
      col += tr * sk;
      vec3 a = exp(-ex * ds);
      col += tr * em * mix(vec3(ds), (1.0 - a) / max(ex, vec3(1e-6)), step(vec3(1e-5), ex * ds));
      tr *= a;
      xPrev = x; t = t1;
    }
  }
  if (!sheetDone) sheet(ro + rd * tCross, rd, col, tr);
  if (!starDone && tCut < 1e8) col += tr * starGlow;
#ifdef FULL
  if (inside && be.y > b.y) envMarch(ro, rd, b.y, be.y, jitter, col, tr);   // the envelope behind the cylinder
#endif
  col = col * uExposure + tr * bg + sky;
  // asinh stretch of the luminance, as for astronomical images of high dynamic range; hue is kept and
  // channels that run past white roll off toward it
  float L = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
  col *= pow(asinh(L / 0.012) / 7.2, 2.2) / L;
  float m = max(col.r, max(col.g, col.b));
  if (m > 1.0) col = mix(col / m, vec3(1.0), 1.0 - 1.0 / m);
  col = mix(pow(col, vec3(1.0 / 2.2)), face.rgb, face.a) + (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;   // the cut face is a picture of a quantity, laid over in display values
  fragColor = vec4(col, 1.0);
}`;


  // The field model again in JS, for the field lines and wind parcels drawn as vector strokes in the SVG
  // overlay (kept in step with FIELD_GLSL above).
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const cutOut = (R) => Math.pow(R / MODEL.R_OUT, MODEL.P_OUT);
  const zBase = (Rf) => MODEL.H0 * Math.pow(Rf, 1.25) * Math.sqrt(2 * Math.max(MODEL.LNTAU1 - 1.25 * Math.log(Rf) - cutOut(Rf), 1));
  const SigmaJS = (R) => Math.exp(-Math.log(R) - cutOut(R)) * ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, R);
  const Hof = (R) => MODEL.H0 * Math.pow(R, 1.25);
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
  // radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf at height h
  function fieldRP(Rf, h) {
    const zb = zBase(Rf), hi = Math.min(h, zb), q = hi * hi / zb;
    let R = Rf + 0.5 * BP.A0 * q, ph = 0.5 * BP.B0 * q / Rf;
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
  const LOOKS = { model: 0, optical: 1, mir: 2, mm: 3 };
  const LOOK_STAR = { model: 1, optical: 1, mir: 0.4, mm: 0.05 };   // the star's glow in each look
  const ja = () => document.documentElement.lang === 'ja';

  function init(box) {
    // data-static renders one frame (used for the fallback image and screenshots)
    const reduce = reduceOS || 'static' in box.dataset;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    // the lookup maps (see MAP_GLSL) are float textures drawn on the GPU; without WebGL2 or float render
    // targets the static picture stays
    const fbFloat = gl && !!gl.getExtension('EXT_color_buffer_float'), fbHalf = fbFloat || (gl && !!gl.getExtension('EXT_color_buffer_half_float'));
    if (!gl || !fbHalf) { box.classList.add('disk-fallback'); return; }
    box.prepend(canvas);
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'disk-overlay'); overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<g class="disk-field"></g><g class="disk-slice"></g><path class="disk-snowline" fill="none"/><text class="disk-label"></text><text class="disk-label disk-plabel"></text><g class="disk-scale"><line/><text/></g><g class="disk-scale"><line/><text/></g>';
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
    const UNAMES = ['uRes', 'uTime', 'uCam', 'uBasis', 'uTanHalf', 'uRSnow', 'uExposure', 'uStar', 'uSteps', 'uSeed', 'uPx', 'uClump', 'uVapor', 'uMode', 'uDiskMap', 'uWindMap', 'uSlice', 'uSliceQ', 'uSliceN', 'uSliceR', 'uSliceZ',
      'uPlanet', 'uTrap', 'uGapRim', 'uPlanetPos', 'uPlanetVis', 'uEnv', 'uEnvMap', 'uSliceOff', 'uSliceFace', 'uLook', 'uComp'];
    const U0 = uniforms(prog, UNAMES);
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
      gl.useProgram(fullP); gl.uniform1i(full.U.uDiskMap, 0); gl.uniform1i(full.U.uWindMap, 1); gl.uniform1i(full.U.uEnvMap, 3);
      return full;
    }
    if (pcomp) startFull();
    const UD = uniforms(progDisk, ['uMapRes', 'uTime', 'uSeed', 'uCam', 'uPixA', 'uPlanet', 'uPlanetPhi', 'uGapLight', 'uWake']);
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
    const windMapT = target(512, 256, fbFloat && fLinear ? gl.RGBA32F : gl.RGBA16F, gl.CLAMP_TO_EDGE);
    gl.useProgram(progWind);
    gl.uniform4fv(gl.getUniformLocation(progWind, 'uTab'), new Float32Array(BP.XI.flatMap((x, i) => [x, BP.PHI[i], BP.TAU[i], Math.log(BP.ETA[i])])));
    gl.uniform2f(gl.getUniformLocation(progWind, 'uMapRes'), windMapT.w, windMapT.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, windMapT.fb); gl.viewport(0, 0, windMapT.w, windMapT.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // the envelope map (see ENVMAP_FS), drawn once, on unit 3
    const envMapT = target(256, 128, gl.RGBA16F, gl.CLAMP_TO_EDGE);
    gl.useProgram(progEnv);
    gl.uniform2f(gl.getUniformLocation(progEnv, 'uMapRes'), envMapT.w, envMapT.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, envMapT.fb); gl.viewport(0, 0, envMapT.w, envMapT.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, envMapT.tex);
    gl.useProgram(prog);
    gl.uniform1i(U0.uDiskMap, 0); gl.uniform1i(U0.uWindMap, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, windMapT.tex);
    // disk map: 2048 texels in ln R (0.0027 per texel) resolve the sheared structure down to the footprint
    // of a pixel at the usual distances on a desktop panel; a narrower canvas (a phone) has larger pixels
    // and gets 1024 or 512, since the map costs the same whatever the size of the picture. 256 around
    // (4 per cell of the finer octave).
    let diskMapT = null;
    function diskTarget() {
      const nx = Math.min(2048, Math.max(512, 2 ** Math.ceil(Math.log2(canvas.width * 1.6))));
      if (diskMapT && diskMapT.w === nx) return;
      if (diskMapT) { gl.deleteFramebuffer(diskMapT.fb); gl.deleteTexture(diskMapT.tex); }
      diskMapT = target(nx, 256, gl.RGBA16F, gl.REPEAT);
      gl.useProgram(progDisk); gl.uniform2f(UD.uMapRes, diskMapT.w, diskMapT.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, diskMapT.tex);
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
    // geometry: NL field lines whose feet come from a 2D Sobol sequence, quasi-uniform in ln R (0.2 to 6.5 au)
    // and azimuth; each line is drawn up to ZTOP, with N_IN points through the disk and the heights CHI_S
    // above it; wind parcels carry a release phase in [0, 1). Lower side: every other line and fewer
    // parcels (weaker wind for an aligned field).
    const NL = 22, N_IN = 6, ZTOP = 9.0, NB = 48, NBM = 24, lines = [], parcels = [];   // levels of the lines and of the marks
    for (let i = 0; i < NL; i++) {
      const [u1, u2] = sobol2(i + 1);
      const Rf = 0.2 * Math.pow(6.5 / 0.2, u1), phi0 = 2 * Math.PI * u2;
      lines.push({ Rf, phi0, side: 1 });
      if (i % 2 === 0) lines.push({ Rf, phi0, side: -1 });
      for (let m = 0; m < 8; m++) parcels.push({ Rf, phi0, side: 1, u: ((m + 0.37 * i) / 8) % 1 });
      if (i % 2 === 0) for (let m = 0; m < 4; m++) parcels.push({ Rf, phi0, side: -1, u: ((m + 0.21 * i) / 4) % 1 });
    }
    // starlight reaching a point at radius R and height h: softened falloff with the distance from the star,
    // shadowed inside the disk (optical depth toward the star)
    const starlight = (R, h) => {
      const Hs = MODEL.H0 * Math.pow(R, 1.25);
      const tau = Math.exp(Math.min(Math.max(MODEL.LNTAU1 - 1.25 * Math.log(R) - cutOut(R) - 0.5 * h * h / (Hs * Hs), -30), 30));
      return (0.2 + 0.8 * Math.exp(-tau)) / (1 + (R * R + h * h) / 16);
    };
    // A line keeps its shape in the frame rotating with its foot, so its samples are computed once: radius,
    // azimuth relative to the foot, height, and the brightness that does not depend on the view (brightest
    // where the line leaves the disk; the wound-up part above fades out, and so does the part near the top,
    // beyond the end of the table and beyond the edge of the disk; weaker below). Each frame then only
    // rotates, projects and applies the scattering angle and the sheet.
    for (const L of lines) {
      const zb = zBase(L.Rf), r0 = L.Rf + 0.5 * BP.A0 * zb;
      const chiEnd = Math.min(Math.max((ZTOP - zb) / r0, 0.5), BP.CHIMAX);
      L.r0 = r0; L.pts = [];
      for (let j = 0, k = 0; ; j++) {
        let h, chi = 0;
        if (j < N_IN) h = zb * j / N_IN;
        else { if (k >= CHI_S.length) break; chi = Math.min(CHI_S[k++], chiEnd); h = zb + r0 * chi; }
        const [R, dphi] = fieldRP(L.Rf, h);
        const fade = Math.exp(-(h - Math.min(h, zb)) / (1.5 * r0 + 2)) * (1 - ss(0.85 * chiEnd, chiEnd, chi)) * (1 - ss(0.6, 1, chi / BP.CHIMAX)) * (1 - ss(8, 11, R)) * (L.side > 0 ? 1 : 0.4);
        L.pts.push({ R, dphi, z: L.side * h, b: fade * starlight(R, h) });
        if (chi >= chiEnd) break;
      }
    }
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
    function sheetT(P) {
      if ((cam[2] > 0) === (P[2] > 0)) return 1;
      const t = cam[2] / (cam[2] - P[2]);
      const cx = cam[0] + (P[0] - cam[0]) * t, cy = cam[1] + (P[1] - cam[1]) * t, Rc = Math.sqrt(cx * cx + cy * cy);
      if (Rc < MODEL.R_IN || Rc > 11) return 1;
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
      const hb = qb[2] > 0.05 ? cut(qb, max) : q, ht = qt[2] > 0.05 && qb[2] > 0.05 ? cut(qt, 2.5 * max) : hb;
      const head = 'L' + fx(q[0]) + ' ' + fx(q[1]);
      if (a * TRACE_TAIL > 0.02 && ht !== hb) d[bucket(a * TRACE_TAIL, NBM)] += 'M' + fx(ht[0]) + ' ' + fx(ht[1]) + 'L' + fx(hb[0]) + ' ' + fx(hb[1]) + head;
      d[bucket(a, NBM)] += 'M' + fx(hb[0]) + ' ' + fx(hb[1]) + head;
    }
    function drawField() {
      if (fieldAmp <= 0) { for (const e of [...halo, ...core, ...dots]) setD(e, ''); return; }
      const gain = Number(box.dataset.field || 0.5) * (opt.slice ? 0.6 : 1);   // quieter behind a slice
      const dL = new Array(NB).fill(''), dD = new Array(NBM).fill('');
      for (const L of lines) {
        const rot = L.phi0 + Omega(L.r0) * time, n = L.pts.length;
        const Q = new Array(n), A = new Array(n);   // projected samples (null behind the camera) and their brightness
        for (let j = 0; j < n; j++) {
          const s = L.pts[j], phi = rot + s.dphi;
          const P = [s.R * Math.cos(phi), s.R * Math.sin(phi), s.z], q = project(P);
          if (q[2] > 0.05 && kept(P)) { Q[j] = q; A[j] = s.b * gain * seen(P) * (1 - faceAlpha(P)); } else { Q[j] = null; A[j] = 0; }
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
        const zb = zBase(p.Rf), r0 = p.Rf + 0.5 * BP.A0 * zb, Om = Omega(r0);
        const chiEnd = Math.min(Math.max((ZTOP - zb) / r0, 0.5), BP.CHIMAX), tEnd = tabF(BP.TAU, tabS(chiEnd));
        const ph = ((p.u + time * Om / tEnd) % 1 + 1) % 1;
        const at = (dt) => {
          const c = chiOfTau(Math.max(0, ph - dt * Om / tEnd) * tEnd), hh = zb + r0 * c;
          const [Rr, dp] = fieldRP(p.Rf, hh), f = p.phi0 + Om * (time - dt) + dp;
          return [Rr * Math.cos(f), Rr * Math.sin(f), p.side * hh];
        };
        const chi = chiOfTau(ph * tEnd), h = zb + r0 * chi;
        const [R, dphi] = fieldRP(p.Rf, h), phi = p.phi0 + Om * time + dphi;
        const P = [R * Math.cos(phi), R * Math.sin(phi), p.side * h], q = project(P);
        if (q[2] <= 0.05 || !kept(P)) continue;
        const a = ss(0, 0.03, ph) * (1 - ss(0.6, 1, ph)) * Math.exp(-(h - zb) / (2 * r0 + 2.5)) * (1 - ss(0.6, 1, chi / BP.CHIMAX)) * (p.side > 0 ? 1 : 0.4) * gain * starlight(R, h) * seen(P) * (1 - faceAlpha(P));
        // (the tail's far end continues the dash backward, which is close enough for a faint tail and saves a third
        // look-up in the table per parcel)
        if (a > 0.02) { const B = at(TRACE_T); tracer(dD, q, project(B), project([3 * B[0] - 2 * P[0], 3 * B[1] - 2 * P[1], 3 * B[2] - 2 * P[2]]), 0.85 * a); }
      }
      for (let b = 0; b < NB; b++) { setD(halo[b], dL[b]); setD(core[b], dL[b]); }
      for (let b = 0; b < NBM; b++) setD(dots[b], dD[b]);
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
          if (q[2] <= 0.05 || !kept(P)) { pen = false; continue; }
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
        if (q[2] <= 0.05 || !kept(P)) continue;
        const a = envVis * modelAmp * ss(0, 0.08, u) * (1 - ss(0.85, 1, u)) * ss(0.13, 0.2, Math.abs(P[2]) / Math.hypot(P[0], P[1])) * 1.4 / Math.sqrt(1 + r * r / 900) * seen(P);
        const du = TRACE_T * ENV.SPEED / L.T;
        if (a > 0.02) tracer(dD, q, project(pointAt(u - du)), project(pointAt(u - 3 * du)), 0.45 * a, 8);
      }
      for (let b = 0; b < NBM; b++) setD(edots[b], dD[b]);
    }

    const opt = {
      rSnow: Number(box.dataset.snow || 0.9),
      el: Number(box.dataset.elevation || 32) * Math.PI / 180,
      az: Number(box.dataset.azimuth || -70) * Math.PI / 180,
      dist: Number(box.dataset.distance || 31),
      fov: Number(box.dataset.fov || 32) * Math.PI / 180,
      scale: Number(box.dataset.scale || 0.6),
      steps: Number(box.dataset.steps || 150),
      exposure: Number(box.dataset.exposure || 1.0),
      spin: Number(box.dataset.spin || 0.004),
      seed: Number(box.dataset.seed || 2.0),
      mode: Number(box.dataset.mode || 63),   // see uMode; 16: the planet, 32: the envelope
      scaleMax: Number(box.dataset.scaleMax || 1),
      // the slice (see uSlice): on with data-slice; data-slice-q picks the quantity on the cut face
      slice: 'slice' in box.dataset,
      sliceQ: box.dataset.sliceQ || 'T',
      // the annotations laid over the picture (the snow line and its label, the scale bar, the planet's label, the
      // lines, labels and colour bar on the slice's face): data-annotations="off" starts without them
      ann: box.dataset.annotations !== 'off',
      // the look (see uLook): 'model', or as observed: 'optical', 'mir', 'mm'
      look: box.dataset.look in LOOKS ? box.dataset.look : 'model'
    };
    const clumps = Array.from({ length: 6 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0, crossed: true }));
    const vapor = Array.from({ length: 4 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0 }));
    let W = 0, Hh = 0, cam, basis, time = 0, last = 0, running = false, dragging = false, moved = false, px = 0, py = 0, azUser = opt.az, elUser = opt.el;
    let paused = false, speed = 1, dirty = true, benching = false, fieldMs = 0;
    const Omega = (R) => 0.5236 * Math.pow(R, -1.5);
    // --- the planet: it fades in and out over about 1.5 s when it is turned on or off (planetAmp); the gap's depth is
    // planetAmp times the depth for the camera's distance (DEPTH), gapDepth, and the wake's strength planetAmp times
    // the strength for that distance, wakeAmp (the observed looks take the near values of both) ---
    const planetPhi = (t) => PLANET.PHI0 + Omega(PLANET.A) * t;
    const planetPos = (t) => { const a = planetPhi(t); return [PLANET.A * Math.cos(a), PLANET.A * Math.sin(a), 0]; };
    let planetAmp = (opt.mode & 16) ? 1 : 0, depthSet = -1, gapDepth = 0, rim = null, trap = trapOf(0), wakeAmp = 0;
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
      return 1 + 29 * ss(0, 1.5, dt) * (dt < 5.5 ? 1 : Math.exp(-(dt - 5.5) / 9));
    };
    const snowNow = () => { rSn = opt.rSnow * Math.sqrt(burstL()); };
    // a short explanation in the panel, faded in and out
    const toast = document.createElement('div');
    toast.className = 'disk-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = 'position:absolute;right:12px;top:12px;max-width:min(360px,calc(100% - 24px));padding:9px 12px;border-radius:6px;'
      + 'background:rgba(10,13,24,.82);color:#dfe8f5;font:12.5px/1.65 var(--sans,sans-serif);letter-spacing:.02em;pointer-events:none;opacity:0;transition:opacity .6s';
    box.appendChild(toast);
    let toastTimer = 0, toastSwap = 0;
    // shows a text for ms; one already showing fades out first (0.25 s), so texts never swap abruptly
    const say = (ja_, en, ms) => {
      clearTimeout(toastTimer); clearTimeout(toastSwap);
      const show = () => { toast.textContent = ja() ? ja_ : en; toast.style.transition = 'opacity .45s'; toast.style.opacity = '1'; toastTimer = setTimeout(hush, ms); };
      if (toast.style.opacity === '1') { toast.style.transition = 'opacity .25s'; toast.style.opacity = '0'; toastSwap = setTimeout(show, 260); } else show();
    };
    const hush = () => { clearTimeout(toastTimer); clearTimeout(toastSwap); toast.style.transition = 'opacity .6s'; toast.style.opacity = '0'; };
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

    // --- the envelope: fades in and out with its component (1.5 s) and shows from about 40 au (envVis) ---
    let envAmp = (opt.mode & 32) ? 1 : 0, envVis = 0;
    // its infall: particles on NS streamlines (SVG dots, like the wind's), from r = 60 au down to the disk's surface
    // (z/R below 0.17), moving ENV.SPEED times faster than the disk's clock, and the streamlines themselves, faint.
    // Each streamline is integrated once in theta (800 steps) with the velocities of ENV, then resampled at equal
    // times (for the particles) and every 40 steps (for the line).
    const GM = 0.5236 * 0.5236;           // au^3 per (visual s)^2: one orbit a year at 1 au (12 s)
    const envLines = [];
    for (let i = 0; i < ENV.NS; i++) {
      const [u1, u2] = sobol2(i + 37);
      const th0 = ENV.TH_CAV + 0.08 + (1.38 - ENV.TH_CAV - 0.08) * u1, c0 = Math.cos(th0), s0 = Math.sin(th0), RC = MODEL.R_OUT;
      let th = Math.acos(c0 * (1 - RC * s0 * s0 / 60)), t = 0, ph = 0;
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

    // The camera looks at the star, or (follow) at the planet, turning with its orbit. Every change of view (buttons,
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
      const Tl = follow ? planetPos(time) : [0, 0, 0], dT = Math.hypot(Tl[0] - camT[0], Tl[1] - camT[1], Tl[2] - camT[2]);
      const m = Math.abs(to[0] - p0[0]) + Math.abs(to[1] - p0[1]) * Math.cos(p0[0]) + Math.abs(to[2] - p0[2]) + dT / Math.max(1, Math.min(camD, opt.dist));
      const dur = Math.min(FLY_MAX, FLY_MIN + 0.45 * m);
      flyV = { t0: now, dur, p0, v0: camV.slice() };
      if (dT > 1e-6 || flyT) flyT = { t0: now, dur, p0: camT.slice(), v0: camTV.slice() };
      dirty = true;
    }
    // a drag or a pinch takes over: the view is left where the flight has brought it
    const takeOver = () => {
      if (!flyV) return;
      elUser = clampEl(camEl); azUser = camAz - viewOff(); opt.dist = camD; flyV = null; camV = [0, 0, 0];
    };
    function camera() {
      const Tl = follow ? planetPos(time) : [0, 0, 0], vl = [elUser, azUser + viewOff(), Math.log(opt.dist)];
      let T = Tl, v = vl;
      if (flyT) { const o = [0, 0, 0]; if (hermite(flyT, Tl, o, camTV)) { flyT = null; camTV = [0, 0, 0]; } else T = o; }
      if (flyV) {
        vl[1] = flyV.p0[1] + wrapPi(vl[1] - flyV.p0[1]);
        const o = [0, 0, 0];
        if (hermite(flyV, vl, o, camV)) { flyV = null; camV = [0, 0, 0]; } else v = o;
      }
      camT = T; camEl = v[0]; camAz = v[1]; camD = Math.exp(v[2]);
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
    // same expressions as the volume ---
    const SZ = 1;                        // vertical scale of the face (uSliceZ); 1: true proportions
    const SLICE_Q = { none: 0, T: 1, rho: 2, tau: 3 };
    const sliceG = overlay.querySelector('.disk-slice');
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
      return wakeAmp * PLANET.WAKE_A * Math.exp(-ax / PLANET.WAKE_L) * ss(0.03, 0.1, ax) * ss(0.42, 0.55, x) * (1 - ss(2, 2.5, x)) * Math.exp(-d * d / (w * w));
    };
    // the disk's density contours on the two halves of the face (azimuths of the right half and opposite), across the
    // arms: finely sampled where the arms are
    let wakeR = null;
    function wakeContours(lr) {
      wakeR = wakeR || [...logspace(MODEL.R_IN * 1.05, 1.2, 40), ...logspace(1.21, 7.6, 420), ...logspace(7.65, 10.5, 20)];
      const phR = Math.atan2(basis.r[1], basis.r[0]), out = [];
      for (const [sr, ph] of [[1, phR], [-1, phR + Math.PI]]) {
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
      const key = q + ':' + Math.round(gapDepth * 50) + ':' + rSn.toFixed(3);
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
          const c = curve((R) => zOfRho(R, lr), MODEL.R_IN * 1.05, 10.5);
          if (c.length > 2) { g.lines.push({ pts: c, quads: ALL, lr }); g.labels.push({ pts: c, t: '10' + sup(lr) }); }
        }
        // (the lower side, at 0.35 of the upper, has its own contours)
        for (const [lr, low] of [[-5, 1], [-6, 1], [-7, 1], [-5, 0.35], [-6, 0.35], [-7, 0.35]]) {
          const c = [];
          for (const Rf of logspace(0.07, 8, 140)) {
            const zb = zBase(Rf), r0 = Rf + 0.5 * BP.A0 * zb;
            const base = -MODEL.LNTAU1 - 1.5 * Math.log(r0) - tabF(lnEta, tabS(CHI_C)) - cutOut(r0) + gapLnJS(r0, gapDepth) + Math.log(Math.max(ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, r0) * low, 1e-30));
            const want = lr * LN10 - base;   // ln ETA at the contour
            if (want > tabF(lnEta, tabS(CHI_C)) || want < lnEta[NT - 1]) continue;
            let lo = tabS(CHI_C), hi = NT - 1.001;
            for (let k = 0; k < 30; k++) { const m = 0.5 * (lo + hi); if (tabF(lnEta, m) > want) lo = m; else hi = m; }
            const chi = chiOfS(0.5 * (lo + hi)), z = zb + r0 * chi;
            if (z < 9) c.push([r0 * tabF(BP.XI, tabS(chi)), z]);
          }
          if (c.length > 2) { g.lines.push(low < 1 ? { pts: c, quads: LOWER } : { pts: c, quads: UPPER }); if (low === 1) g.labels.push({ pts: c, t: '10' + sup(lr) }); }
        }
      } else if (q === 'tau') {
        for (const k of [-3, -2, -1, 1, 2, 3, 4]) {
          const c = curve((R) => zOfTau(R, k * LN10), MODEL.R_IN * 1.05, 10.6);
          if (c.length > 2) { g.lines.push(c); g.labels.push({ pts: c, t: 'τ* = 10' + sup(k) }); }
        }
      }
      sliceGeom.key = key; sliceGeom.g = g;
      g.tau1 = logspace(MODEL.R_IN, 10.6, 240).map((R) => [R, zOfTau(R, 0)]).filter((pt) => !isNaN(pt[1]));
      g.ice = [[rSn, 0], ...logspace(rSn, rIceS(), 80).map((R) => [R, zOfTau(R, 0)]), [rIceS(), zOfTau(rIceS(), -4.6)]];
      return g;
    }
    const sup = (k) => String(k).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    // lines on every face: the irradiation surface (tau* = 1); the ice boundary, vertical at the snow line in
    // the interior and along the irradiation surface out to where 2.8 T_mid = 160 K; the pebble layer; the
    // field lines in the plane (the R-z shape of the solution) with points for the wind velocity
    const rIceS = () => rSn * 2.8 * 2.8;
    const planeLines = logspace(0.12, 7, 9).map((Rf) => {
      const zb = zBase(Rf), r0 = Rf + 0.5 * BP.A0 * zb, pts = [];
      for (let j = 0; j < 8; j++) { const h = zb * j / 8; pts.push([fieldRP(Rf, h)[0], h, -1]); }
      for (const chi of CHI_S) { const h = zb + r0 * chi, R = fieldRP(Rf, h)[0]; if (h > 9.5 || R > 11) break; pts.push([R, h, chi]); }
      return { r0, pts };
    });
    const vK = (r0) => 29.78 / Math.sqrt(r0);   // km/s, for a star of one solar mass (one orbit a year at 1 au)
    // a slice element: a path with fixed style, or a pool of labels
    const mkS = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); sliceG.appendChild(e); return e; };
    const sP = {
      contour: mkS('path', { fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.55, 'stroke-width': 0.9 }),
      flines: mkS('path', { fill: 'none', stroke: '#cfe3ff', 'stroke-opacity': 0.5, 'stroke-width': 0.8 }),
      arrows: mkS('path', { fill: 'none', stroke: '#e8f4ff', 'stroke-opacity': 0.85, 'stroke-width': 1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      tau1: mkS('path', { fill: 'none', stroke: '#fff3df', 'stroke-opacity': 0.95, 'stroke-width': 1.5 }),
      ice: mkS('path', { fill: 'none', stroke: '#9fe0ff', 'stroke-width': 1.6, 'stroke-dasharray': '4 4' }),
      rock: mkS('path', { fill: 'none', stroke: '#b07a52', 'stroke-width': 2.2 }),
      icy: mkS('path', { fill: 'none', stroke: '#e3f1ff', 'stroke-width': 2.2 }),
      pile: mkS('path', { fill: 'none', stroke: '#f2f8ff', 'stroke-width': 4 }),
      planet: mkS('path', { fill: '#ffd9a8', stroke: '#0a0d18', 'stroke-width': 1 })
    };
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
      T: { col: (u) => tcolorJS(T0 * Math.pow(T1 / T0, u)), ticks: [50, 100, 160, 300, 1000].map((T) => [uT(T), String(T)]), title: ['温度 (K)', 'temperature (K)'] },
      rho: { col: (u) => cmapJS(u, 'viridis'), ticks: [-9, -6, -3, 0].map((l) => [(l + 10) / 12.5, '10' + sup(l)]), title: ['ガスの密度(1 au の赤道面に対する比)', 'gas density (relative to the midplane at 1 au)'] },
      tau: { col: (u) => cmapJS(u, 'inferno'), ticks: [-3, 0, 3].map((l) => [(l + 4) / 9, '10' + sup(l)]), title: ['星の方向の光学的厚さ τ*', 'optical depth toward the star τ*'] }
    };
    const cbarId = 'disk-cbar-' + Math.random().toString(36).slice(2, 9);
    const cbarDefs = mkS('defs', {});
    cbarDefs.innerHTML = '<linearGradient id="' + cbarId + '" x1="0" x2="1" y1="0" y2="0"></linearGradient>';
    const cbarGrad = cbarDefs.firstChild;
    const CBW = 220;
    const cbarRect = mkS('rect', { x: 18, y: 24, width: CBW, height: 8, fill: 'url(#' + cbarId + ')', stroke: 'rgba(190,215,240,0.5)', 'stroke-width': 0.6 });
    const cbarTicks = mkS('path', { fill: 'none', stroke: 'rgba(190,215,240,0.8)', 'stroke-width': 1 });
    let cbarFor = '';
    function drawCbar(q, li) {
      const c = CBAR[q];
      cbarRect.setAttribute('visibility', c ? 'visible' : 'hidden');
      if (!c) { cbarTicks.setAttribute('d', ''); return li; }
      if (cbarFor !== q) {
        cbarGrad.innerHTML = Array.from({ length: 25 }, (_, i) => { const u = i / 24, k = c.col(u).map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))); return '<stop offset="' + u.toFixed(3) + '" stop-color="rgb(' + k.join(',') + ')"/>'; }).join('');
        cbarFor = q;
      }
      let d = '';
      for (const [u, t] of c.ticks) { const x = 18 + CBW * u; d += 'M' + x.toFixed(1) + ' 32L' + x.toFixed(1) + ' 36'; sLabel(li++, x, 47, t, 'middle'); }
      cbarTicks.setAttribute('d', d);
      sLabel(li++, 18, 18, c.title[ja() ? 0 : 1]);
      return li;
    }
    const sLabel = (i, x, y, text, anchor) => {
      if (!sLabels[i]) sLabels[i] = mkS('text', { class: 'disk-label', stroke: '#0a0d18', 'stroke-width': 3, 'stroke-opacity': 0.75, 'paint-order': 'stroke' });
      const e = sLabels[i]; e.textContent = text; e.setAttribute('x', x.toFixed(1)); e.setAttribute('y', y.toFixed(1)); e.setAttribute('text-anchor', anchor || 'start');
    };
    const sp = (Rs, z) => project([Rs * basis.r[0], Rs * basis.r[1], z * SZ]);
    const inView = (q) => q && q[2] > 0.05 && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < Hh;
    // a polyline in (R, z), drawn in the four quadrants of the face that the flags allow
    function pathOf(pts, quads) {
      let d = '';
      for (const [sr, sz] of quads) {
        let pen = false;
        for (const [R, z] of pts) {
          const q = sp(sr * R, sz * z);
          if (q[2] <= 0.05) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true;
        }
      }
      return d;
    }
    const ALL = [[1, 1], [-1, 1], [1, -1], [-1, -1]], UPPER = ALL.slice(0, 2), LOWER = ALL.slice(2);
    // opacity of the face where the segment from the camera to P crosses the plane (P on the far side): hides
    // the field lines and particles behind it (the density face covers the wind as well)
    function faceAlpha(P) {
      if (sliceU < 0.82 || opt.sliceQ === 'none') return 0;
      const off = sliceOff(), cn = cam[0] * basis.n[0] + cam[1] * basis.n[1] - off, pn = P[0] * basis.n[0] + P[1] * basis.n[1] - off;
      if (cn <= 0 || pn > 0) return 0;
      const t = cn / (cn - pn), C = [cam[0] + (P[0] - cam[0]) * t, cam[1] + (P[1] - cam[1]) * t, cam[2] + (P[2] - cam[2]) * t];
      const R = Math.hypot(C[0], C[1]), z = C[2] / SZ;
      if (opt.sliceQ === 'rho') return R < 10.5 && Math.abs(z) < 8.5 ? ss(0.82, 1, sliceU) : 0;
      const x = lnTauJS(Math.max(R, 1e-3), z), hole = ss(MODEL.R_IN * 0.8, MODEL.R_IN * 1.3, R);
      return (opt.sliceQ === 'T' ? ss(-6, -4.5, x) : ss(-4.5, -3.5, x / LN10)) * hole * ss(0.82, 1, sliceU);
    }
    // The slice opens and closes as a sweep: sliceU goes from 0 (closed) to 1 (open) in 1.5 s, as the fades do, and
    // the plane moves from SWEEP au in front of the star (nothing cut) to the star, eased like the flights. The lines and
    // labels on the face, drawn for the plane through the star, show only at the end of the sweep.
    const SWEEP = 11;
    let sliceU = opt.slice ? 1 : 0, annAmp = opt.ann ? 1 : 0;   // annAmp: the annotations' fade (0.4 s)
    // A change of look dips the exposure for 0.6 s and takes effect at its darkest (lookNow), so the picture never
    // jumps; the model's own drawings (field lines, wind tracers, the envelope's streamlines) fade out in the observed
    // looks (fieldAmp, which also fades the field lines' toggle).
    let lookNow = opt.look, lookT0 = -1e9, fieldAmp = 1;
    // Other fades (in real time, as the others): the components gas, surface, pebbles and wind (compAmp, 0.6 s; uComp),
    // the model's drawings of the envelope between looks (modelAmp, 0.4 s), the scale bar when it changes its length
    // (the old bar fades out as the new one fades in, 0.25 s; both are true to scale)
    const COMP_BITS = [1, 2, 4, 8], compAmp = COMP_BITS.map((b) => (opt.mode & b ? 1 : 0));
    let modelAmp = opt.look === 'model' ? 1 : 0, sbLb = 0, sbOld = 0, sbT = -1e9;
    const toward = (cur, want, dt, secs) => (reduce ? want : want > cur ? Math.min(want, cur + dt / secs) : Math.max(want, cur - dt / secs));
    const fadesDone = () => COMP_BITS.every((b, i) => compAmp[i] === (opt.mode & b ? 1 : 0)) && modelAmp === (lookNow === 'model' ? 1 : 0) && performance.now() - sbT >= 250;
    const lookDip = () => { const u = (performance.now() - lookT0) / 600; return reduce || u >= 1 || u <= 0 ? 1 : 1 - 0.92 * Math.sin(Math.PI * u); };
    const sliceOff = () => { const u = sliceU; return SWEEP * (1 - u * u * (3 - 2 * u)); };
    // the part of space kept by the slice: the side of the plane away from the camera
    const kept = (P) => sliceU <= 0 || P[0] * basis.n[0] + P[1] * basis.n[1] <= sliceOff();
    function drawSlice() {
      sliceG.setAttribute('opacity', (ss(0.82, 1, sliceU) * annAmp).toFixed(3));
      if (sliceU <= 0) { for (const k in sP) sP[k].setAttribute('d', ''); sLabels.forEach((e) => { e.textContent = ''; }); drawCbar('', 0); return; }
      const ja_ = ja(), g = buildSlice(opt.sliceQ), face = opt.sliceQ !== 'none';
      let li = 0;
      sP.contour.setAttribute('d', g.lines.map((c) => (Array.isArray(c) ? pathOf(c, ALL) : c.lr != null && wakeAmp > 0 ? wakeContours(c.lr) : pathOf(c.pts, c.quads))).join(''));
      sP.tau1.setAttribute('d', pathOf(g.tau1, ALL));
      sP.ice.setAttribute('d', pathOf(g.ice, ALL));
      // the pebble layer: rock inside the snow line, ice outside, thick where it piles up (just outside the snow line,
      // and at the planet's pressure maximum); broken across the planet's gap
      const spans = (R0, R1, ok) => { const out = []; let a = null; for (let R = R0; R <= R1 + 1e-9; R += 0.01) { if (ok(R)) { if (a === null) a = R; } else if (a !== null) { out.push([a, R]); a = null; } } if (a !== null) out.push([a, R1]); return out; };
      const segs = (list) => list.map(([a, b]) => pathOf([[a, 0], [b, 0]], UPPER)).join('');
      const peb = (R) => pebbleJS(R, gapDepth);
      sP.rock.setAttribute('d', segs(spans(MODEL.R_IN, rSn, (R) => peb(R) > 0.3)));
      sP.icy.setAttribute('d', segs(spans(rSn, 8.4, (R) => peb(R) > 0.3)));
      sP.pile.setAttribute('d', segs([[rSn * 1.02, rSn * 1.3], ...spans(Math.max(rSn, 2), 8.4, (R) => peb(R) > 1.8)]));
      // the planet's orbit, where it crosses the plane
      sP.planet.setAttribute('d', planetAmp > 0.5 ? [-1, 1].map((sr) => { const c = sp(sr * PLANET.A, 0); return c[2] > 0.05 ? 'M' + (c[0] - 4).toFixed(1) + ' ' + c[1].toFixed(1) + 'l4 -4l4 4l-4 4z' : ''; }).join('') : '');
      // field lines in the plane, and arrows for the gas velocity in the plane, (v_R, v_z) = v_K(r0) F (dxi/dchi, 1),
      // spaced along the lines on the screen, 0.6 px per km/s (at most 42 px); fewer below (the weaker side)
      let dF = '', dA = '';
      if (showField) for (const L of planeLines) dF += pathOf(L.pts, ALL);
      if (opt.mode & 8) for (const L of planeLines) for (const [sr, sz] of ALL) {
        let acc = 0, prev = null;
        const gap = sz > 0 ? 64 : 110;
        for (let i = 0; i + 1 < L.pts.length; i++) {
          const [R, h, chi] = L.pts[i];
          const q = sp(sr * R, sz * h), q2 = sp(sr * L.pts[i + 1][0], sz * L.pts[i + 1][1]);
          if (q[2] <= 0.05 || q2[2] <= 0.05) { prev = null; continue; }
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
      // labels, on the right half of the upper face where they fall inside the picture, without overlaps (in
      // order of importance; the contour labels are spread across the right half)
      li = drawCbar(opt.sliceQ, li);
      const boxes = [[0, 0, CBW + 30, 52]], textW = (t) => [...t].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 11 : 6.3), 0);
      const place = (x, y, t, anchor) => {
        const w = textW(t), x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, b = [x0 - 2, y - 11, x0 + w + 2, y + 3];
        if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > Hh - 24 || boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return;
        boxes.push(b); sLabel(li++, x, y, t, anchor);
      };
      const at = (pts, xFrac) => { let best = null; for (const [R, z] of pts) { const q = sp(R, z); if (inView(q) && (!best || Math.abs(q[0] - xFrac * W) < Math.abs(best[0] - xFrac * W))) best = q; } return best; };
      if (dA) {
        const x0 = W - 36, y0 = Hh - 18;   // 30 km/s at 0.6 px per km/s
        sP.arrows.setAttribute('d', dA + 'M' + x0 + ' ' + y0 + 'L' + (x0 + 18) + ' ' + y0 + 'M' + (x0 + 14) + ' ' + (y0 - 3) + 'L' + (x0 + 18) + ' ' + y0 + 'L' + (x0 + 14) + ' ' + (y0 + 3));
        boxes.push([x0 - 60, y0 - 12, W, Hh]); sLabel(li++, x0 - 6, y0 + 4, '30 km/s', 'end');
      }
      let q = at(g.tau1, 0.62); if (q) place(q[0], q[1] - 6, 'τ* = 1', 'middle');
      q = sp(PLANET.A, 0); if (planetAmp > 0.5 && inView(q)) place(q[0] + 8, q[1] - 8, ja_ ? '惑星の軌道' : 'planet orbit');
      q = sp(rSn, 0.55 * zOfTau(rSn, 0)); if (inView(q)) place(q[0] - 5, q[1], ja_ ? '氷の境界' : 'ice line', 'end');
      q = at([[0.5 * (MODEL.R_IN + rSn), 0], [2, 0], [4, 0]], 0.72); if (q) place(q[0], q[1] + 15, ja_ ? '小石の層' : 'pebbles', 'middle');
      if (face) g.labels.forEach((lb, i) => {
        const q2 = lb.pts ? at(lb.pts, 0.55 + 0.08 * (i % 5)) : sp(lb.R, lb.z);
        if (inView(q2)) place(q2[0] + 4, q2[1] - 4, lb.t);
      });
      for (let i = li; i < sLabels.length; i++) sLabels[i].textContent = '';
    }
    function resize() {
      // the height follows data-aspect when given (the canvas's default size would otherwise set it)
      W = box.clientWidth; Hh = box.dataset.aspect ? Math.round(W * Number(box.dataset.aspect)) : (box.clientHeight || Math.round(W * 0.62));
      box.style.height = Hh + 'px';
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * opt.scale;
      canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(Hh * dpr));
      overlay.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      diskTarget();
      draw();
    }
    let fadeT = 0, fstats = null;   // fstats: a running measurement, see diskFrameStats
    function draw() {
      if (!W) return;
      const d0 = fstats ? performance.now() : 0;
      // the planet's fade, in real time (so that it also completes while the model is paused); the step is at most 0.1 s,
      // since a paused model draws nothing until something changes and the first frame of a fade would otherwise jump
      // to its end
      const now = performance.now(), want = (opt.mode & 16) ? 1 : 0, dtR = fadeT ? Math.min(0.1, (now - fadeT) / 1000) : 0;
      fadeT = now;
      planetAmp = reduce ? want : want > planetAmp ? Math.min(want, planetAmp + dtR / planetFade) : Math.max(want, planetAmp - dtR / planetFade);
      const wantS = opt.slice ? 1 : 0;
      sliceU = reduce ? wantS : wantS > sliceU ? Math.min(wantS, sliceU + dtR / 1.5) : Math.max(wantS, sliceU - dtR / 1.5);
      const wantA = opt.ann ? 1 : 0;
      annAmp = reduce ? wantA : wantA > annAmp ? Math.min(wantA, annAmp + dtR / 0.4) : Math.max(wantA, annAmp - dtR / 0.4);
      if (lookNow !== opt.look && (reduce || performance.now() - lookT0 >= 300)) lookNow = opt.look;
      const wantF = showField && lookNow === 'model' ? 1 : 0;
      fieldAmp = reduce ? wantF : wantF > fieldAmp ? Math.min(wantF, fieldAmp + dtR / 0.4) : Math.max(wantF, fieldAmp - dtR / 0.4);
      fieldG.setAttribute('opacity', fieldAmp.toFixed(3));
      COMP_BITS.forEach((b, i) => { compAmp[i] = toward(compAmp[i], opt.mode & b ? 1 : 0, dtR, 0.6); });
      modelAmp = toward(modelAmp, lookNow === 'model' ? 1 : 0, dtR, 0.4);
      if (planetAmp === want) planetFade = 1.5;
      snowNow();
      const wantE = (opt.mode & 32) ? 1 : 0;
      envAmp = reduce ? wantE : wantE > envAmp ? Math.min(wantE, envAmp + dtR / 1.5) : Math.max(wantE, envAmp - dtR / 1.5);
      camera();
      envVis = envAmp * ss(30, 50, Math.hypot(cam[0], cam[1], cam[2]));
      planetUniforms();
      const pPos = planetPos(time), pVis = planetAmp * (1 - ss(1.5, 5, Math.hypot(cam[0] - pPos[0], cam[1] - pPos[1], cam[2] - pPos[2])));
      // the disk map for this moment and view (the footprints of the pixels depend on the camera)
      gl.useProgram(progDisk);
      gl.uniform1f(UD.uPlanetPhi, planetPhi(time));
      wakeAmp = planetAmp * (lookNow === 'model' ? wakeFor(cam) : 1);
      gl.uniform1f(UD.uWake, wakeAmp);
      gl.uniform1f(UD.uTime, time);
      gl.uniform1f(UD.uSeed, opt.seed);
      gl.uniform3fv(UD.uCam, cam);
      gl.uniform1f(UD.uPixA, 2 * Math.tan(opt.fov / 2) / canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, diskMapT.fb); gl.viewport(0, 0, diskMapT.w, diskMapT.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // the volume, with the FULL program while the slice or the planet close up shows
      const F = sliceU > 0 || opt.slice || pVis > 0 || envVis > 0 || lookNow !== 'model' ? fullProgram() : null, U = F ? F.U : U0;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(F ? F.prog : prog);
      gl.uniform1f(U.uPlanet, gapDepth);
      gl.uniform3f(U.uTrap, trap.R, trap.filt, trap.s);
      gl.uniform4f(U.uGapRim, rim ? rim.R : 1e9, rim ? rim.th : 0, rim ? rim.end : 0, rim ? rim.h : 1);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, time);
      gl.uniform3fv(U.uCam, cam);
      gl.uniformMatrix3fv(U.uBasis, false, [...basis.r, ...basis.u, ...basis.f]);
      gl.uniform1f(U.uTanHalf, Math.tan(opt.fov / 2));
      gl.uniform1f(U.uRSnow, rSn);
      gl.uniform1f(U.uExposure, opt.exposure * Math.pow(burstL(), 0.6) * lookDip());   // brighter starlight, compressed by the stretch
      gl.uniform1f(U.uStar, Math.pow(burstL(), 0.7) * LOOK_STAR[lookNow]);
      gl.uniform1i(U.uLook, LOOKS[lookNow]);
      gl.uniform1i(U.uSteps, Math.round(opt.steps * (camD < 10 ? 2 : 1)));   // finer march when zoomed in
      gl.uniform1f(U.uSeed, opt.seed);
      gl.uniform1f(U.uPx, canvas.width / W);
      gl.uniform4fv(U.uClump, clumps.flatMap((c) => [c.R, c.phi, c.t0, c.amp]));
      gl.uniform4fv(U.uVapor, vapor.flatMap((v) => [v.R, v.phi, v.t0, v.amp]));
      gl.uniform1i(U.uMode, (opt.mode & ~15) | COMP_BITS.reduce((m, b, i) => m | (compAmp[i] > 0 ? b : 0), 0));
      gl.uniform4fv(U.uComp, compAmp.map((v) => v * v * (3 - 2 * v)));
      gl.uniform1i(U.uSlice, sliceU > 0 ? 1 : 0);
      gl.uniform1f(U.uSliceOff, sliceOff());
      gl.uniform1f(U.uSliceFace, ss(0.82, 1, sliceU));
      gl.uniform1i(U.uSliceQ, SLICE_Q[opt.sliceQ] || 0);
      gl.uniform3fv(U.uSliceN, basis.n);
      gl.uniform3fv(U.uSliceR, basis.r);
      gl.uniform1f(U.uSliceZ, SZ);
      gl.uniform3fv(U.uPlanetPos, pPos);
      gl.uniform1f(U.uPlanetVis, pVis);
      gl.uniform1f(U.uEnv, envVis);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const f0 = performance.now(), o0 = f0;
      drawField();
      drawEnv();
      fieldMs = performance.now() - f0;
      drawSlice();
      // snow line annotation, projected with the same camera; with the slice, only the half that is kept
      // (on a painted face the ice boundary is drawn instead)
      let d = '', best = null, pen = false;
      const ringA = annAmp * (opt.sliceQ === 'none' ? 1 : 1 - ss(0.82, 1, sliceU)), ringOn = ringA > 0.002;
      for (let i = 0; i <= 72 && ringOn; i++) {
        const a = i / 72 * Math.PI * 2, P = [rSn * Math.cos(a), rSn * Math.sin(a), 0];
        if (!kept(P)) { pen = false; continue; }
        const q = project(P);
        d += (pen ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); pen = true;
        if (!best || q[1] > best[1]) best = q;
      }
      ring.setAttribute('d', d + (sliceU > 0 ? '' : 'Z'));
      label.textContent = best ? (ja() ? 'スノーライン' : 'snow line') : '';
      const aop = annAmp.toFixed(3);
      ring.setAttribute('opacity', ringA.toFixed(3)); label.setAttribute('opacity', ringA.toFixed(3));
      if (best) { label.setAttribute('x', best[0] + 8); label.setAttribute('y', best[1] + 14); }
      // the planet, named when it shows (close up)
      const pq = project(pPos), pa = ss(0.3, 0.6, pVis) * (kept(pPos) ? 1 : 0);
      plabel.textContent = pa > 0 && pq[2] > 0.05 ? (ja() ? '惑星と周惑星円盤' : 'planet and its disk') : '';
      if (plabel.textContent) {
        const rc = 0.4 * PLANET.RH / pq[2] * Hh / (2 * basis.th);   // radius of the planet's disk on the screen (px)
        plabel.setAttribute('x', (pq[0] + 0.75 * rc + 10).toFixed(1)); plabel.setAttribute('y', (pq[1] - 0.35 * rc - 12).toFixed(1)); plabel.setAttribute('opacity', (pa * annAmp).toFixed(2));
      }
      const QN = { T: ['温度', 'temperature'], rho: ['ガスの密度', 'gas density'], tau: ['星の方向の光学的厚さ', 'optical depth toward the star'], none: ['', ''] }[opt.sliceQ] || ['', ''];
      canvas.setAttribute('aria-label', ja()
        ? '原始惑星系円盤(半径8 au)のモデルを立体的に描いた図。表層は暖かく、赤道面は冷たく、ダストが赤道面に沈み、約1 auのスノーラインの外側で氷をまとっています。' + (planetAmp > 0.5 ? '3 au に木星質量の惑星があり、ギャップを開けています。' : '') + (envVis > 0.5 ? '遠くからは、円盤を包むエンベロープと、軸に沿った空洞の明るい壁が見えます。' : '') + (opt.slice ? '星を通る鉛直な面で手前の半分を切り取り、切り口に' + (QN[0] ? QN[0] + 'を色で示しています。' : '円盤の内部を見せています。') : '')
        : 'Volume rendering of a model protoplanetary disk (8 au in radius): warm surface layers, a cold midplane with settled dust, and a water snow line near 1 au.' + (planetAmp > 0.5 ? ' A Jupiter-mass planet at 3 au opens a gap.' : '') + (envVis > 0.5 ? ' From afar, the infalling envelope shows, with the bright walls of a cavity along the axis.' : '') + (opt.slice ? ' The near half is cut away along a vertical plane through the star; the cut face shows ' + (QN[1] ? 'the ' + QN[1] + ' in colour.' : 'the inside of the disk.') : ''));
      // scale bar: 1 au (or a round multiple) at the distance of the star (of the planet when following it)
      const o = project(camT), r1 = project(camT.map((v, i) => v + basis.r[i])), pxAu = o[2] > 0.1 ? Math.hypot(r1[0] - o[0], r1[1] - o[1]) : 0;
      let Lb = 0.05; for (const c of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200]) if (c * pxAu <= 150) Lb = c;
      if (Lb !== sbLb) { if (sbLb && !reduce) { sbOld = sbLb; sbT = performance.now(); } sbLb = Lb; }
      const sbU = Math.min(1, (performance.now() - sbT) / 250), x0 = 18, y0 = Hh - 18;
      const bar = (g, L, a) => {
        const [ln, tx] = g.children;
        ln.setAttribute('x1', x0); ln.setAttribute('x2', x0 + L * pxAu); ln.setAttribute('y1', y0); ln.setAttribute('y2', y0);
        tx.textContent = pxAu > 0 && a > 0 ? L + ' au' : ''; tx.setAttribute('x', x0); tx.setAttribute('y', y0 - 6);
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
        const Rc = c.R - 0.05 * (time - c.t0);
        if (!c.crossed && Rc < rSn) {
          c.crossed = true;
          const tc = c.t0 + (c.R - rSn) / 0.05;
          const v = vapor.reduce((a, b) => (a.amp <= 0 || a.t0 < b.t0 ? a : b));
          v.R = 0.88 * rSn; v.phi = c.phi + Omega(rSn) * (tc - c.t0); v.t0 = tc; v.amp = c.amp;
        }
        if (Rc < 0.08 || time - c.t0 > 120) c.amp = 0;
      }
      for (const v of vapor) if (v.amp > 0 && time - v.t0 > 30) v.amp = 0;
    }
    // a flight, a fade or the sweep under way
    const busy = () => !!(flyV || flyT) || planetAmp !== ((opt.mode & 16) ? 1 : 0) || envAmp !== ((opt.mode & 32) ? 1 : 0) || sliceU !== (opt.slice ? 1 : 0)
      || annAmp !== (opt.ann ? 1 : 0) || lookNow !== opt.look || lookDip() < 1 || fieldAmp !== (showField && lookNow === 'model' ? 1 : 0) || !fadesDone();
    function frame(t) {
      if (!running) return;
      if (benching) { last = 0; lastRaw = 0; requestAnimationFrame(frame); return; }   // diskBench draws on its own
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      if (fstats) { fstats.t.push(t); dirty = true; if (t >= fstats.until) fsDone(); } else adapt(t);
      if (!paused) { time += dt * speed; update(); dirty = true; }
      if (busy()) dirty = true;   // flights, fades and the sweep run in real time (see draw)
      if (dirty) { draw(); dirty = false; }
      requestAnimationFrame(frame);
    }
    const start = () => { if (!reduce && !running) { running = true; last = 0; requestAnimationFrame(frame); } };
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
        size: [canvas.width, canvas.height], scale: opt.scale, visible: document.visibilityState === 'visible' });
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
    const prefetch = () => { if (gapLight.prefetch()) idle(prefetch); };
    idle(prefetch);
    const stop = () => { running = false; };
    const addClump = (R, phi, age) => {
      const c = clumps.reduce((a, b) => (a.amp <= 0 ? a : b.amp <= 0 ? b : a.t0 < b.t0 ? a : b));
      c.R = R; c.phi = phi; c.t0 = time - (age || 0); c.amp = 1; c.crossed = R - 0.05 * (age || 0) < rSn;
    };

    // --- input: drag to rotate, wheel, pinch or keys to zoom, click to drop pebbles ---
    // On touch screens one finger moving sideways rotates and moving up or down scrolls the page
    // (touch-action: pan-y); two fingers tilt the view and pinch to zoom.
    // closest approach: 2 au, or 0.25 au with the slice, where the structure of the inner disk (a few
    // hundredths of an au thick at 0.1 au) is to be seen
    const DMAX = 160, dist0 = opt.dist, el0 = opt.el, az0 = opt.az, dmin = () => (follow ? 0.25 : opt.slice ? 0.25 : 2);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (coarse) canvas.style.touchAction = 'pan-y';
    canvas.tabIndex = 0;
    const clampEl = (v) => Math.min(1.45, Math.max(-1.45, v));
    const touched = () => { dirty = true; if (reduce) draw(); };
    // tells the page that the view or the components changed from inside (keys, tour, easter eggs, a drag)
    const emitState = () => { if (box.diskState) box.dispatchEvent(new CustomEvent('diskstate', { detail: box.diskState() })); };
    const zoomBy = (f) => { opt.dist = Math.min(DMAX, Math.max(dmin(), opt.dist * f)); startFly(); touched(); };
    const ptrs = new Map(); let pinch0 = 0, distPinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // (only a real pointer can be captured; events made by a script have none)
      if (e.isTrusted) canvas.setPointerCapture(e.pointerId);
      takeOver(); stopTour(false);
      if (ptrs.size === 1) { dragging = true; moved = false; px = e.clientX; py = e.clientY; }
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); distPinch = opt.dist; moved = true; }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], mx = 0.5 * (a.x + b.x), my = 0.5 * (a.y + b.y);
        p.x = e.clientX; p.y = e.clientY;
        const mx2 = 0.5 * (a.x + b.x), my2 = 0.5 * (a.y + b.y), d2 = Math.hypot(a.x - b.x, a.y - b.y);
        azUser -= (mx2 - mx) * 0.006; elUser = clampEl(elUser + (my2 - my) * 0.006);
        if (pinch0 > 0 && d2 > 0) opt.dist = Math.min(DMAX, Math.max(dmin(), distPinch * pinch0 / d2));
        touched(); return;
      }
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      azUser -= dx * 0.006;
      if (!coarse || e.pointerType === 'mouse') elUser = clampEl(elUser + dy * 0.006);
      px = e.clientX; py = e.clientY; p.x = e.clientX; p.y = e.clientY;
      touched();
    });
    const endPtr = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; if (ptrs.size === 0) dragging = false; };
    canvas.addEventListener('pointercancel', (e) => { endPtr(e); moved = true; });
    canvas.addEventListener('pointerup', (e) => {
      const wasDrag = moved; endPtr(e);
      if (wasDrag) emitState();
      if (wasDrag || ptrs.size) return;
      // click: drop pebbles where the ray meets the midplane
      const rect = canvas.getBoundingClientRect();
      // the star: an outburst
      const so = project([0, 0, 0]);
      if (so[2] > 0.05 && Math.hypot(e.clientX - rect.left - so[0], e.clientY - rect.top - so[1]) < 14) { startBurst(); touched(); return; }
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      const th = Math.tan(opt.fov / 2), asp = W / Hh;
      const rd = [0, 1, 2].map((i) => basis.f[i] + th * (nx * asp * basis.r[i] + ny * basis.u[i]));
      const t = -cam[2] / rd[2]; if (t <= 0) return;
      const x = cam[0] + rd[0] * t, y = cam[1] + rd[1] * t, R = Math.hypot(x, y);
      if (R < 0.15 || R > 8.5 || !kept([x, y, 0]) || faceAlpha([x, y, 0]) > 0.5) return;
      addClump(R, Math.atan2(y, x), 0);
      seedPlanet(R);
      touched();
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); stopTour(false); zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))); }, { passive: false });
    // The keys: arrows turn, + and - zoom, Home goes back to the first view, space pauses; 1 to 5 the views
    // (VIEWS, in step with the preview page's buttons), P the planet, F the field lines, S the slice, A the annotations.
    const VIEWS = [[el0 * 180 / Math.PI, az0 * 180 / Math.PI, dist0], [10, -80, 24], [2, -80, 24], [80, -65, 30], [-14, -80, 24]];
    const PLANET_VIEW = { p: 1, el: 30, az: 160, d: 1.6 };
    canvas.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      stopTour(false);
      const k = e.key; let used = true;
      const view = (st) => { if (opt.slice) box.diskSlice(false); box.diskSet({ ...st, fly: 1 }); };
      if (k === 'ArrowLeft') { azUser += 0.08; startFly(); } else if (k === 'ArrowRight') { azUser -= 0.08; startFly(); }
      else if (k === 'ArrowUp') { elUser = clampEl(elUser + 0.05); startFly(); } else if (k === 'ArrowDown') { elUser = clampEl(elUser - 0.05); startFly(); }
      else if (k === '+' || k === '=') zoomBy(0.8); else if (k === '-' || k === '_') zoomBy(1.25);
      else if (k === 'Home') { box.diskSet({ p: 0, slice: 0, el: el0 * 180 / Math.PI, az: az0 * 180 / Math.PI, d: dist0, fly: 1 }); }
      else if (k === ' ') box.diskPlay(paused);
      else if (k >= '1' && k <= '5') { const v = VIEWS[Number(k) - 1]; view({ p: 0, el: v[0], az: v[1], d: v[2] }); }
      else if (k === 'p' || k === 'P') view(PLANET_VIEW);
      else if (k === 'f' || k === 'F') box.diskField(!showField);
      else if (k === 's' || k === 'S') box.diskSlice(!opt.slice);
      else if (k === 'a' || k === 'A') box.diskAnnotations(!opt.ann);
      else used = false;
      if (used) { e.preventDefault(); touched(); emitState(); }
    });
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
    new ResizeObserver(resize).observe(box);
    new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? start() : stop()))).observe(box);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    resize();
    box.diskSetTime = (t) => { time = t; update(); draw(); };
    box.diskBurst = () => { startBurst(); touched(); };
    // a clump of pebbles dropped as a click drops one (three near the planet's orbit grow it, see seedPlanet)
    box.diskAddClump = (R, phi, age) => { addClump(R, phi, age); if (!age) seedPlanet(R); draw(); };
    // controls for the preview page: view (degrees, au), components, time, state for links, snapshots
    // (to 0.01 degree and 0.001 au, so that a link restores the picture to within a pixel)
    const deg = (r) => Math.round(r * 18000 / Math.PI) / 100;
    // az is measured from the planet's azimuth while following it (p = 1)
    box.diskState = () => ({ el: deg(elUser), az: deg(azUser + (follow || reduce ? 0 : opt.spin * time)), d: Math.round(opt.dist * 1000) / 1000, mode: opt.mode, field: showField ? 1 : 0, speed, paused: paused ? 1 : 0, time, slice: opt.slice ? 1 : 0, sq: opt.sliceQ, p: follow ? 1 : 0, ann: opt.ann ? 1 : 0, look: opt.look });
    box.diskSet = (st) => {
      // the slice and following the planet first (they exclude each other), since they set how close the camera may come
      if (st.slice != null) { opt.slice = !!Number(st.slice); if (opt.slice) follow = false; }
      if (st.p != null) { follow = !!Number(st.p); if (follow) opt.slice = false; }
      if (st.sq != null && st.sq in SLICE_Q) opt.sliceQ = st.sq;
      opt.dist = Math.max(opt.dist, dmin());
      // the time before the view: az is the azimuth at that time (the slow spin is taken off it)
      if (st.time != null) { time = Number(st.time); update(); }
      if (st.el != null) elUser = clampEl(st.el * Math.PI / 180);
      if (st.az != null) azUser = st.az * Math.PI / 180 - (follow || reduce ? 0 : opt.spin * time);
      if (st.d) opt.dist = Math.min(DMAX, Math.max(dmin(), st.d));
      if (st.mode != null) opt.mode = Number(st.mode);
      if (st.field != null) showField = !!Number(st.field);
      if (st.ann != null) opt.ann = !!Number(st.ann);
      // the look: the slice belongs to the model's look (opening it returns there; an observed look closes it)
      if (st.look != null && st.look in LOOKS && st.look !== opt.look) {
        opt.look = st.look; lookT0 = performance.now();
        if (opt.look !== 'model' && opt.slice && st.slice == null) box.diskSlice(false);
      }
      if (opt.slice && opt.look !== 'model') { opt.look = 'model'; lookT0 = performance.now(); }
      if (st.speed) speed = Number(st.speed);
      if (st.paused != null) paused = !!Number(st.paused);
      // a new view: with fly the camera flies there from where it is, otherwise it is there at once
      if (st.el != null || st.az != null || st.d != null || st.p != null || st.slice != null) { if (Number(st.fly)) startFly(); else flyV = flyT = null; }
      touched();
    };
    box.diskView = (elevationDeg, azimuthDeg, distance) => box.diskSet({ el: elevationDeg, az: azimuthDeg, d: distance, p: 0 });
    box.diskPlanetView = () => box.diskSet({ ...PLANET_VIEW, fly: 1 });
    // --- the tour: the highlights in turn, each with a short text, then back to the first view. It turns on what it
    // shows (the planet, the envelope), and stops when the visitor takes over (a drag, the wheel, a key) or asks. The
    // page learns of it from disktour events. ---
    const comps = (bits) => { if ((opt.mode & bits) !== bits) { box.diskSet({ mode: opt.mode | bits }); box.dispatchEvent(new CustomEvent('diskmode', { detail: { mode: opt.mode } })); } };
    const home = () => box.diskSet({ p: 0, el: VIEWS[0][0], az: VIEWS[0][1], d: VIEWS[0][2], fly: 1 });
    const TOUR = [
      { go: () => { if (opt.slice) box.diskSlice(false); home(); }, ms: 8000,
        ja: '原始惑星系円盤のモデル(半径 8 au)。星の光が反り返った表層を温め、赤道面は冷たいままです。約 1 au のスノーラインの外では、赤道面に沈んだ小石が氷をまとっています。表面からは、磁場に駆動された風が吹き出しています。',
        en: 'A model protoplanetary disk, 8 au in radius. Starlight warms its flared surface while the midplane stays cold; beyond the snow line near 1 au the pebbles settled at the midplane are icy. A magnetically driven wind leaves the surface.' },
      { go: () => { comps(16); if (opt.slice) box.diskSlice(false); box.diskPlanetView(); }, ms: 9500,
        ja: '3 au の木星質量の惑星です。ガスを押しのけてギャップを開け、まわりに周惑星円盤を持っています。後ろに明るく見えるのは、星の光を受けたギャップの外側の壁です。',
        en: 'A Jupiter-mass planet at 3 au. It pushes the gas aside into a gap and has its own circumplanetary disk; behind it, the outer wall of the gap is lit by the star.' },
      { go: () => box.diskSlice(true, 'T'), ms: 10000,
        ja: '星を通る断面です。色は温度で、星の光が届く表層(白い線 τ* = 1 より上)は熱く、内部は冷たいままです。水色の破線は氷の境界、矢印は円盤風の速さです。',
        en: 'A slice through the star, coloured by temperature: the layer reached by starlight (above the white line, tau* = 1) is hot and the interior cold. The dashed line is the ice boundary; the arrows show the wind.' },
      { go: () => { comps(32); box.diskSlice(false); box.diskSet({ p: 0, el: 14, az: -65, d: 90, fly: 1 }); }, ms: 10000,
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
    // the slice for the page, the keys and the tour: opening flies to a low, close view of the inner disk (6 degrees,
    // 2.4 au) as the plane sweeps in; closing flies back to the view before as it sweeps out
    let sliceBefore = null;
    box.diskSlice = (on, sq) => {
      if (sq && sq in SLICE_Q) opt.sliceQ = sq;
      if (!!on !== opt.slice) {
        if (on) { const st = box.diskState(); sliceBefore = { el: st.el, az: st.az, d: st.d, p: st.p }; box.diskSet({ slice: 1, el: 6, d: 2.4, fly: 1 }); }
        else { box.diskSet({ slice: 0 }); if (sliceBefore) box.diskSet({ ...sliceBefore, fly: 1 }); sliceBefore = null; }
      }
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
          n: ok.length, disjoint, size: [canvas.width, canvas.height], scale: opt.scale, steps: Math.round(opt.steps * (opt.dist < 10 ? 2 : 1)) };
      } finally { benching = false; dirty = true; }
    };
    box.diskScale = (sc) => { opt.scale = sc; resize(); };
    // draws until every flight, fade and sweep has finished (at most maxMs): for scripts and tests, and it works in a
    // hidden page too, where no animation frames come. Each frame is waited for (a pixel read back), so that frames do
    // not pile up on the GPU when they are slow.
    box.diskSettle = async (maxMs = 5000) => {
      const mc = new MessageChannel(), px = new Uint8Array(4); let wake = null;
      mc.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
      const t0 = performance.now();
      for (;;) {
        draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (!busy() || performance.now() - t0 > maxMs) break;
        await new Promise((r) => { wake = r; mc.port2.postMessage(0); });
      }
      dirty = true;
      return !busy();
    };
    box.diskSteps = (n) => { opt.steps = n; };
    // a PNG of the current frame: the volume plus the overlay (lines, snow line, scale bar); with { canvas: true } the
    // canvas it is drawn on instead (for checks: encoding a PNG takes a second or more in a background page)
    box.diskSnapshot = async (o = {}) => {
      fullWait = true; draw(); fullWait = false;
      const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
      const c2 = out.getContext('2d'); c2.drawImage(canvas, 0, 0);
      const sv = overlay.cloneNode(true);
      sv.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); sv.setAttribute('width', out.width); sv.setAttribute('height', out.height);
      const style = (sel, attrs) => sv.querySelectorAll(sel).forEach((el) => { for (const k in attrs) el.setAttribute(k, attrs[k]); });
      style('.disk-snowline', { stroke: 'rgba(190,215,240,0.55)', 'stroke-width': 1, 'stroke-dasharray': '3 5' });
      style('.disk-scale line', { stroke: 'rgba(190,215,240,0.85)', 'stroke-width': 1 });
      style('text', { fill: 'rgba(190,215,240,0.85)', 'font-family': 'Helvetica, Arial, sans-serif', 'font-size': 11, 'letter-spacing': '0.04em' });
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(sv)], { type: 'image/svg+xml' }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      c2.drawImage(img, 0, 0, out.width, out.height); URL.revokeObjectURL(url);
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
