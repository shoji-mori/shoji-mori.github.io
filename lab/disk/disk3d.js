// Volume rendering of a model protoplanetary disk (inner 8 au), drawn on the GPU.
//
// The structure follows an irradiated, magnetically accreting disk:
//   gas        Σ ∝ R^-1, vertically Gaussian with H/R = 0.025 (R/au)^1/4 (T_mid ∝ R^-1/2)
//   rotation   Keplerian, Ω ∝ R^-3/2; turbulent structure is sheared by it into trailing spirals
//   heating    starlight grazes the flared surface and is absorbed where the optical depth toward
//              the star reaches unity, a few scale heights up; that thin skin is hot and bright,
//              while the midplane stays cool (T_mid = 150 K at 1 au), so the water snow line sits
//              near 1 au as in a magnetically accreting disk
//   dust       large grains settle into a thin layer at the midplane; they are icy where
//              T < 160 K, bare rock inside, with a modest pile-up of ice just outside the
//              snow line from re-condensing vapor
//   wind       a magnetically driven wind leaves the irradiated surface, stronger on one
//              side as for a field aligned with the rotation
//   inner edge dust sublimates inside about 0.08 au
// Rendering: the irradiated skin, far thinner than a ray step, is integrated analytically through
// its profile of absorbed starlight (bright where seen at a grazing angle; corrugations that face
// the star catch more light); the settled dust is a sheet crossed analytically at the midplane. The
// gas is drawn translucent (a real disk is opaque at visible wavelengths) so that the dust sheet and
// the snow line show through. Colour encodes temperature: amber where it is warm (inner disk,
// irradiated surface), blue where it is cold (outer midplane); icy dust is pale, rocky dust dark.
// Brightness follows the absorbed starlight with a softened falloff beyond 1 au and an asinh stretch.
// Clicking drops a clump of pebbles: it shears out, drifts inward and loses its ice inside
// the snow line; the vapor spreads outward and freezes again.
// This is a schematic model for the website, not simulation output.
(function () {
  // Magnetic field lines, shared by the volume (wind glow) and the line pass. They come from a numerical
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
  // Inside the disk the radial and toroidal fields grow linearly with height (uniform currents), so the
  // line bends smoothly into the wind. Lines are labelled by their foot radius Rf at the midplane; below
  // the midplane they are mirrored.
  const BP = {
    XI: [1, 1.0459, 1.094, 1.1445, 1.1974, 1.253, 1.3114, 1.3727, 1.4372, 1.5049, 1.5762, 1.6512, 1.73, 1.813, 1.9003, 1.9921, 2.0887, 2.1904, 2.2973, 2.4097, 2.5279, 2.6521, 2.7827, 2.9198, 3.0638, 3.215, 3.3736, 3.5398, 3.714, 3.8963, 4.0871, 4.2865, 4.4948, 4.712, 4.9383, 5.1739, 5.4186, 5.6726, 5.9356, 6.2076, 6.4881, 6.7769, 7.0733, 7.3768, 7.6864, 8.0012, 8.3199, 8.6411, 8.963, 9.2838, 9.601, 9.9122, 10.214, 10.505, 10.779, 11.034, 11.265, 11.469, 11.64, 11.775, 11.869, 11.919, 11.919, 11.868],
    PHI: [0.0039947, -0.084394, -0.17558, -0.26978, -0.36721, -0.4681, -0.57269, -0.68123, -0.79399, -0.91124, -1.0333, -1.1604, -1.293, -1.4314, -1.576, -1.7271, -1.8852, -2.0508, -2.2244, -2.4065, -2.5976, -2.7984, -3.0095, -3.2316, -3.4656, -3.7122, -3.9722, -4.2468, -4.5368, -4.8434, -5.1677, -5.5112, -5.8752, -6.2612, -6.6709, -7.106, -7.5685, -8.0605, -8.5843, -9.1424, -9.7374, -10.372, -11.05, -11.775, -12.55, -13.38, -14.268, -15.221, -16.242, -17.34, -18.518, -19.786, -21.149, -22.618, -24.2, -25.907, -27.748, -29.737, -31.887, -34.211, -36.727, -39.45, -42.4, -45.597],
    TAU: [-4.0518, 0.1778, 1.2026, 1.8367, 2.3168, 2.712, 3.0559, 3.3658, 3.6529, 3.923, 4.1815, 4.4316, 4.6761, 4.9172, 5.1565, 5.3957, 5.6359, 5.8785, 6.1245, 6.3749, 6.6307, 6.8929, 7.1625, 7.4404, 7.7276, 8.0253, 8.3344, 8.6561, 8.9916, 9.342, 9.7088, 10.093, 10.497, 10.922, 11.369, 11.841, 12.34, 12.867, 13.425, 14.017, 14.645, 15.313, 16.024, 16.781, 17.588, 18.449, 19.37, 20.354, 21.408, 22.537, 23.749, 25.049, 26.447, 27.95, 29.569, 31.312, 33.193, 35.222, 37.414, 39.784, 42.348, 45.123, 48.13, 51.389]
  };
  const FIELD_GLSL = `
uniform vec3 uTab[64];                  // (xi, PHI, TAU) at chi_i = C0 (e^(s_i) - 1), s_i = i SMAX / 63
const float C0 = 0.25, SMAX = 5.484797, CHIMAX = 60.0;   // the solution goes on to chi = 134
const float A0 = 2.0570, B0 = -3.9977;  // dR/dz and B_phi/B_z where the line leaves the surface
float zBase(float Rf){ float H = H0 * pow(Rf, 1.25); return H * sqrt(2.0 * max(8.5 - 1.25 * log(Rf), 1.0)); }
vec3 tabF(float f){ f = clamp(f, 0.0, 62.999); int i = int(f); return mix(uTab[i], uTab[i + 1], f - float(i)); }
vec3 tabAt(float chi){ return tabF(log(1.0 + chi / C0) * (63.0 / SMAX)); }
// radius and azimuth (relative to the foot; negative = lagging) of the line with foot Rf, at height h
vec2 fieldRP(float Rf, float h){
  float zb = zBase(Rf), hi = min(h, zb), q = hi * hi / zb;
  vec2 rp = vec2(Rf + 0.5 * A0 * q, 0.5 * B0 * q / Rf);
  if (h > zb) { vec3 t = tabAt((h - zb) / rp.x); rp = vec2(rp.x * t.x, rp.y + t.y); }
  return rp;
}
// foot radius of the line through (R, h): R(Rf) is monotonic at fixed h (nested lines, also where they
// turn back toward the axis), so bisect
float footRadius(float R, float h){
  float lo = 0.05, hi = R;
  for (int i = 0; i < 9; i++) { float m = 0.5 * (lo + hi); if (fieldRP(m, h).x > R) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
`;
  // The wind carries small grains, so the field lines and the wind glow shine by scattered starlight.
  // Henyey-Greenstein phase function in the scattering angle star -> point -> observer, strongly forward
  // (g = 0.6: 25 times brighter straight ahead than at 90 degrees, 0.39 times straight back), given
  // relative to 90 degrees and softly limited so that the forward peak does not burn out.
  const SCATTER_GLSL = `
const float G_HG = 0.6;
float phaseHG(float mu){
  float p = pow((1.0 + G_HG * G_HG) / (1.0 + G_HG * G_HG - 2.0 * G_HG * mu), 1.5);
  return p / (1.0 + p / 8.0);
}
`;
  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

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
uniform int uSteps;
uniform float uSeed;
uniform float uPx;      // render pixels per CSS pixel
uniform vec4 uClump[6];
uniform vec4 uVapor[4];
uniform int uMode;      // 0 all, 1 gas body, 2 surface skin, 3 dust sheet, 4 wind

const float PI = 3.14159265, TAU = 6.2831853;
const float R_IN = 0.08, H0 = 0.025, TICE = 160.0;
${FIELD_GLSL}
${SCATTER_GLSL}
const float OMEGA0 = 0.5236;            // 2π / 12 s at 1 au (visual time)
const float RB = 10.0, ZB = 3.0;        // marched cylinder (au); the unlit disk beyond is the sheet alone
const float LNTAU1 = 8.5;               // ln of the grazing optical depth toward the star at the midplane, 1 au
// Opacities are set for a translucent rendering (a real disk is opaque at visible wavelengths):
// gas with small grains, settled pebbles (opaque, and their mostly thin millimetre-like emission), wind.
const float K_G = 0.8, K_D = 400.0, K_MM = 40.0, K_W = 0.1;
// Brightness of each component per unit of absorbed starlight E (see Eabs)
const float G_SKIN = 0.04, G_GAS = 0.015, G_DUST = 1.4, G_WIND = 0.125;
const float RELIEF = 0.9;               // brightening per unit slope of the corrugated surface
const float PILE = 0.5;                 // extra glow of the ice pile-up beyond its surface density
const float N_PHI = 32.0, F_LNR = 12.0;  // turbulent cells around the disk and per unit ln R
const float TILT_PITCH = 0.5;           // tan of the pitch of a structure when it forms (27 degrees)
const vec3 EXT = vec3(0.90, 0.97, 1.08); // small grains absorb blue light more strongly
const vec3 STARCOL = vec3(1.0, 0.87, 0.72);

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

// Turbulent structure in (ln R, φ), carried around by Keplerian rotation and sheared by it. A
// structure lives about LIFE/Ω and is then replaced, so the spirals keep a steady pitch at every
// radius instead of winding up. Lifetimes come in bands four times apart (blended in radius), each
// with two staggered generations (blended in time). fp is the pixel footprint in ln R: unresolved
// detail fades out. Returns the relative perturbation of the first octave and, with fine = true,
// that of both octaves and the slope along ln R in units of the local wavenumber.
const float LIFE = 1.5, AGE0 = 0.25;
vec3 turb(float lnR, float phi, float Om, float fp, float seed, bool fine){
  float b = log(LIFE / Om) * 0.7213475, bf = smoothstep(0.3, 0.7, fract(b));
  vec3 n = vec3(0.0); float w2 = 0.0;
  float tilt = N_PHI / TAU / TILT_PITCH;
  for (int j = 0; j < 2; j++) {
    float wb = j == 0 ? 1.0 - bf : bf;
    if (wb <= 0.0) continue;
    float band = floor(b) + float(j), T = exp2(2.0 * band);
    for (int k = 0; k < 2; k++) {
      float c = uTime / T + 0.5 * float(k) + 0.37 * band;
      float fc = fract(c), age = (AGE0 + fc) * T, w = wb * (1.0 - abs(2.0 * fc - 1.0));
      vec2 dq = vec2(N_PHI / TAU * 1.5 * Om * age + tilt, F_LNR);   // dq/dlnR after shearing
      float kr = length(dq);
      vec2 q = vec2(N_PHI / TAU * (phi - Om * age) + tilt * lnR, F_LNR * lnR + seed + 17.0 * floor(c) + 41.0 * float(k) + 29.0 * band);
      float a1 = 1.0 - smoothstep(0.3, 0.7, kr * fp);
      vec3 o;
      if (fine) {
        float a2 = 1.0 - smoothstep(0.3, 0.7, 2.0 * kr * fp);
        vec3 v = vnoiseD(q, N_PHI), v2 = vnoiseD(2.0 * q + vec2(0.0, 7.3), 2.0 * N_PHI);
        o = vec3(a1 * v.x, 0.7 * a1 * v.x + 0.3 * a2 * v2.x, (0.7 * a1 * dot(v.yz, dq) + 0.3 * a2 * dot(v2.yz, dq)) / kr);
      } else {
        o = vec3(a1 * vnoiseP(q, N_PHI), 0.0, 0.0);
      }
      n += w * o; w2 += w * w;
    }
  }
  return n * inversesqrt(w2);
}

// The model shows the inner 8 au of a larger disk: the gas continues outward (and still hides what is
// behind it), while the light is faded beyond 8 au.
float Sigma(float R, float lnR){ float r = R * R / 169.0; r *= r; return exp(-lnR - r * r) * smoothstep(R_IN * 0.8, R_IN * 1.3, R); }
float win(float R){ float r = R * R / 60.84; return exp(-r * r); }
// Starlight absorbed per unit area of the surface, L β / 4πR², with β the grazing angle. Shown with
// the true R^-2 falloff inside 1 au, easing to R^-1.1 outside (scattered-light images are often
// scaled by R² for the same reason), and faded beyond 8 au.
float Eabs(float R, float lnR, float H){
  float a = max(LNTAU1 - 1.25 * lnR, 1.0);
  float beta = H * sqrt(2.0 * a) / R * (0.25 - 0.625 / a) + 0.004 / R;
  return beta / 0.022 * pow(1.0 + R, 0.9) / (0.66 * (R * R + 0.01)) * smoothstep(R_IN * 0.85, R_IN * 1.5, R) * win(R);
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
  return clamp(LNTAU1 - 1.25 * lnR - 0.5 * p.z * p.z / (H * H), -30.0, 30.0);
}

// Faint wind streaks: density is ribbed across field lines and pulsed along them.
float streaks(float lnRf, float pf, float sv){
  vec2 q = vec2(pf / TAU * 40.0, lnRf * 14.0);
  float a = vnoiseP(q, 40.0) + 0.5 * vnoiseP(2.0 * q + vec2(0.0, 3.1), 80.0);
  float b = vnoiseP(vec2(pf / TAU * 6.0, sv * 1.4), 6.0);
  return smoothstep(0.0, 0.55, a) * (0.55 + 0.9 * (b + 0.5));
}

// One step of the ray march, from the previous sample (with ln τ* = xPrev) to p over a length ds.
// Returns emission and extinction per unit length for the gas and the wind, and the emission of the
// irradiated skin integrated over the step (it is far thinner than a step, so it is integrated
// analytically through the profile of absorbed starlight).
void sampleDisk(vec3 p, vec3 rd, float xPrev, float ds, float wpx, out vec3 em, out vec3 ex, out vec3 skin, out float x){
  em = vec3(0.0); ex = vec3(0.0); skin = vec3(0.0);
  float R = max(length(p.xy), 1e-3), lnR = log(R);
  float H = H0 * exp(1.25 * lnR);
  float z = p.z, az = abs(z), zh = z / H;
  float aR = LNTAU1 - 1.25 * lnR;
  x = clamp(aR - 0.5 * zh * zh, -30.0, 30.0);
  if (R < R_IN * 0.7) return;

  if (max(x, xPrev) > -14.0) {
    float phi = atan(p.y, p.x), Om = OMEGA0 * exp(-1.5 * lnR);
    float Tm = TICE * sqrt(uRSnow / R), Ts = 2.8 * Tm;
    float E = Eabs(R, lnR, H);
    // pixel footprint in ln R; on an inclined disk it is stretched along the line of sight
    float fp = wpx / R * (1.0 + (1.0 / max(abs(rd.z), 0.1) - 1.0) * abs(dot(p.xy / R, normalize(rd.xy + 1e-6))));
    // the irradiated skin: absorbed starlight j = E |d e^-τ* / dz|, integrated exactly for x varying
    // linearly over the step. The surface is corrugated by the turbulence; slopes facing the star
    // catch more light.
    bool atSkin = max(x, xPrev) > -4.5 && min(x, xPrev) < 2.2;
    vec3 n = turb(lnR, phi, Om, fp, uSeed, atSkin);
    if (atSkin && (uMode == 0 || uMode == 2)) {
      float dx = x - xPrev, xm = 0.5 * (x + xPrev);
      float P = abs(dx) > 1e-3 ? (exp(-exp(xPrev)) - exp(-exp(x))) / dx : exp(xm - exp(xm));
      skin = G_SKIN * E * az / (H * H) * ds * P * max(0.0, 1.0 + 0.5 * n.y + RELIEF * n.z) * tcolor(Ts);
    }
    // gas with small grains: dark and translucent, faintly glowing in the colour of its temperature
    // (cold midplane; warm only inside the snow line)
    float rho = Sigma(R, lnR) / (2.5066 * H) * exp(-0.5 * zh * zh) * exp(1.6 * n.x - 0.08);
    ex = K_G * rho * EXT;
    if (uMode == 0 || uMode == 1) em = G_GAS * K_G * rho * E * tcolor(Tm);

    // water vapor released inside the snow line, spreading outward
    for (int i = 0; i < 4; i++) {
      vec4 v = uVapor[i]; if (v.w <= 0.0) continue;
      float dt = uTime - v.z; float Rv = v.x + 0.03 * dt;
      float dphi = phi - (v.y + Om * dt); dphi = mod(dphi + PI, TAU) - PI;
      float wr = 0.08 + 0.02 * dt, wp = 0.12 + 0.02 * dt;
      float g = exp(-pow((R - Rv) / wr, 2.0) - pow(dphi / wp, 2.0) - 0.5 * zh * zh);
      em += v.w * vec3(0.55, 0.78, 1.0) * g * exp(-dt / 9.0) / H;
    }
  }

  // magnetic wind above the irradiation surface, one side stronger (aligned field)
  if (x < 0.0) {
    // the field line through p (the same solution as the line pass) and the height above its wind base
    float Rf = footRadius(R, az), zb = zBase(Rf), r0 = Rf + 0.5 * A0 * zb, lnr0 = log(r0);
    float above = max(az - zb, 0.0);
    float s = sqrt(above * above + (R - r0) * (R - r0));   // ~ poloidal length above the base
    float rw = 2.2 * exp(-s / (0.8 * r0 + 0.4) - r0 / 1.5) * inversesqrt(r0) * smoothstep(0.0, 0.05 + 0.1 * r0, above)
             * smoothstep(0.12, 0.4, Rf) * (z > 0.0 ? 1.0 : 0.35) * (1.0 - smoothstep(0.6, 1.0, above / (r0 * CHIMAX)));
    // lit by the star (softened falloff, as for the disk); skipped where too faint to see
    float lit = G_WIND * rw / (length(p) + 0.3) * phaseHG(dot(p, -rd) / max(length(p), 1e-3));
    if (lit > 2e-4) {
      // streaks ride the field lines: co-rotating with the foot, wound back as they rise, and carried
      // outward with the gas (a parcel keeps TAU - Omega t fixed)
      float Om = OMEGA0 * exp(-1.5 * lnr0);
      vec3 t = tabAt(above / r0);
      float pf = atan(p.y, p.x) - Om * uTime - fieldRP(Rf, az).y;
      float st = streaks(lnr0, pf, t.z - Om * uTime);
      if (uMode == 0 || uMode == 4) em += lit * st * vec3(0.55, 0.80, 1.0);
      ex += K_W * 0.05 * rw * st;
    }
  }
}

// The settled dust is far thinner than a ray step, so it is integrated analytically where the ray
// crosses the midplane: a sheet of surface density Σ_d(R, φ), icy beyond the snow line. It hides
// what lies behind it, and glows in proportion to its (millimetre-like, mostly thin) optical depth,
// so pile-ups and clumps of pebbles stand out.
void sheet(vec3 p, vec3 rd, float fp, inout vec3 col, inout vec3 tr){
  float mu = abs(rd.z);
  float R = length(p.xy);
  if (R < R_IN || R > 13.5) return;
  float lnR = log(R), phi = atan(p.y, p.x);
  float Om = OMEGA0 * exp(-1.5 * lnR), H = H0 * exp(1.25 * lnR);
  float Tm = TICE * sqrt(uRSnow / R);
  float ice = 1.0 - smoothstep(TICE - 6.0, TICE + 6.0, Tm);
  float pile = 1.0 + 1.2 * ice * exp(-pow((R - 1.15 * uRSnow) / (0.13 * uRSnow), 2.0));
  float nd = turb(lnR, phi, Om, fp / R * (1.0 + (1.0 / max(mu, 0.1) - 1.0) * abs(dot(p.xy / R, normalize(rd.xy + 1e-6)))), uSeed + 11.0, true).x;
  float sd = 0.012 * Sigma(R, lnR) * pile * (0.5 + 0.5 * ice) * max(0.0, 1.0 + 1.0 * nd), sc = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 c = uClump[i]; if (c.w <= 0.0) continue;
    float dt = uTime - c.z; float Rc = c.x - 0.05 * dt; if (Rc < R_IN) continue;
    float dphi = phi - (c.y + Om * dt); dphi = mod(dphi + PI, TAU) - PI;
    float w = 0.10 + 0.012 * dt;
    sc += c.w * 0.05 * (0.45 + 0.55 * ice) * exp(-pow((R - Rc) / 0.08, 2.0) - pow(dphi / w, 2.0)) * exp(-dt / 70.0);
  }
  sd += sc;
  float tau = K_D * sd / max(mu, 0.03);
  float tmm = K_MM * sd / max(mu, 0.3);
  vec3 alb = mix(vec3(0.42, 0.20, 0.10) * 0.25, 0.9 * tcolor(min(Tm, 120.0)), ice);
  alb = mix(alb, vec3(0.85, 0.92, 1.0) * mix(0.35, 1.0, ice), sc / (sd + 1e-6));   // packed pebbles look paler
  vec3 src = G_DUST * alb * Eabs(R, lnR, H) * (1.0 - exp(-tmm)) * (1.0 + PILE * (pile - 1.0));
  if (uMode != 0 && uMode != 3) src = vec3(0.0);
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
  vec3 starGlow = STARCOL * (40.0 * exp(-dpx * dpx / 1.2) + 0.4 * exp(-dpx / 2.0) + 0.02 / (1.0 + dpx * dpx / 50.0));
  float tStar = max(-dot(ro, rd), 0.0);

  vec3 col = vec3(0.0), tr = vec3(1.0);
  vec2 b = boundsCyl(ro, rd);
  bool starDone = false;
  float tCross = abs(rd.z) > 1e-5 ? -ro.z / rd.z : -1.0;
  bool inside = b.y > b.x;
  // the midplane crossing may lie in the unlit outer disk, in front of or behind the marched part
  bool sheetDone = tCross <= 0.0;
  if (!sheetDone && (!inside || tCross < b.x)) { sheet(ro + rd * tCross, rd, tCross * pixA, col, tr); sheetDone = true; }
  if (inside) {
    float jitter = hash12(gl_FragCoord.xy * 1.37 + 0.5);
    float t = b.x;
    vec3 p = ro + rd * t;
    float xPrev = lnTauStar(p);
    for (int i = 0; i < 160; i++) {
      if (i >= uSteps || t > b.y || max(tr.r, max(tr.g, tr.b)) < 0.01) break;
      float R = length(p.xy);
      // steps follow the scale height in the disk and grow with height above it (only the wind is
      // there); beyond the lit region only the dust sheet matters, and it is crossed analytically
      float Hs = H0 * pow(max(R, 0.2), 1.25), az = abs(p.z);
      float ds = clamp(max(0.4 * Hs, (az > 4.5 * Hs ? 0.25 : 0.18) * az), 0.004, 0.4);
      if (i == 0) ds *= 0.25 + jitter;
      float t1 = t + ds;
      if (!sheetDone && t1 >= tCross) { sheet(ro + rd * tCross, rd, tCross * pixA, col, tr); sheetDone = true; }
      if (!starDone && t1 >= tStar) { col += tr * starGlow; starDone = true; }
      p = ro + rd * t1;
      vec3 em, ex, sk; float x;
      sampleDisk(p, rd, xPrev, ds, t1 * pixA, em, ex, sk, x);
      col += tr * sk;
      vec3 a = exp(-ex * ds);
      col += tr * em * mix(vec3(ds), (1.0 - a) / max(ex, vec3(1e-6)), step(vec3(1e-5), ex * ds));
      tr *= a;
      xPrev = x; t = t1;
    }
  }
  if (!sheetDone) sheet(ro + rd * tCross, rd, tCross * pixA, col, tr);
  if (!starDone) col += tr * starGlow;
  // alpha carries the sheet's depth along the ray (as a fraction of 64 au; 0 when the ray misses it) so the
  // line pass can hide field lines that lie behind the opaque dust sheet and keep the ones in front
  float sheetDepth = (sheetDone && tCross > 0.0) ? clamp(tCross / 64.0, 0.0, 1.0) : 0.0;
  col = col * uExposure + tr * bg + sky;
  // asinh stretch of the luminance, as for astronomical images of high dynamic range; hue is kept and
  // channels that run past white roll off toward it
  float L = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
  col *= pow(asinh(L / 0.012) / 7.2, 2.2) / L;
  float m = max(col.r, max(col.g, col.b));
  if (m > 1.0) col = mix(col / m, vec3(1.0), 1.0 - 1.0 / m);
  col = pow(col, vec3(1.0 / 2.2)) + (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  fragColor = vec4(col, sheetDepth);
}`;


  // Field lines and wind particles. Attribute per vertex: (R_foot, phi_foot, u, kind)
  //   kind 0: field line, u = position along the strip; kind 1: wind parcel, u = release phase in [0, 1);
  //   kinds 2 and 3: the same below the midplane (weaker wind for a field aligned with the rotation).
  // Lines follow the MHD wind solution (see FIELD_GLSL) up to ZTOP; parcels move with the solution's flow.
  const LVS = `#version 300 es
in vec4 a;
uniform vec3 uCam; uniform mat3 uBasis; uniform float uTanHalf; uniform vec2 uRes; uniform float uTime; uniform float uPx;
out float vFade; out float vSide; out float vKind; out float vDepth;
const float PI = 3.14159265, TAU = 6.2831853, OMEGA0 = 0.5236, H0 = 0.025;
const float ZTOP = 9.0, U_IN = 0.12;    // top of the drawn lines (au); share of the strip inside the disk
const float LNTAU1 = 8.5;               // as in the volume: ln of the optical depth toward the star at the midplane, 1 au
${FIELD_GLSL}
${SCATTER_GLSL}
// height chi reached after a travel time tau (TAU increases monotonically along the table)
float chiOfTau(float tau){
  float lo = 0.0, hi = 63.0;
  for (int i = 0; i < 9; i++) { float m = 0.5 * (lo + hi); if (tabF(m).z > tau) hi = m; else lo = m; }
  return C0 * (exp(0.5 * (lo + hi) * SMAX / 63.0) - 1.0);
}
void main(){
  float Rf = a.x, phi0 = a.y, u = a.z, kind = a.w;
  float side = kind >= 2.0 ? -1.0 : 1.0;
  float k = kind >= 2.0 ? kind - 2.0 : kind;
  float zb = zBase(Rf), r0 = Rf + 0.5 * A0 * zb, Om = OMEGA0 * pow(r0, -1.5);
  float chiEnd = clamp((ZTOP - zb) / r0, 0.5, CHIMAX);
  float h, fade;
  if (k > 0.5) {
    // parcels released at a steady rate, each moving with the flow of the solution; they are spaced
    // closely where the gas is slow (near the base) and spread out as it accelerates
    float tEnd = tabAt(chiEnd).z;
    float ph = fract(u + uTime * Om / tEnd);
    float chi = chiOfTau(ph * tEnd);
    h = zb + r0 * chi;
    fade = smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.6, 1.0, ph)) * exp(-(h - zb) / (2.0 * r0 + 2.5)) * (1.0 - smoothstep(0.6, 1.0, chi / CHIMAX));
  } else {
    // the first part of the strip runs through the disk, the rest is spaced evenly in ln(1 + chi/C0)
    h = u < U_IN ? zb * u / U_IN : zb + r0 * C0 * (exp((u - U_IN) / (1.0 - U_IN) * log(1.0 + chiEnd / C0)) - 1.0);
    fade = exp(-max(h - zb, 0.0) / (1.5 * r0 + 2.0)) * (1.0 - smoothstep(0.85, 1.0, u))
         * (1.0 - smoothstep(0.6, 1.0, max(h - zb, 0.0) / (r0 * CHIMAX)));   // the table ends at CHIMAX
  }
  vec2 rp = fieldRP(Rf, h);
  fade *= 1.0 - smoothstep(8.0, 11.0, rp.x);   // the model shows the inner ~8 au (as the disk light does)
  float phi = phi0 + Om * uTime + rp.y;
  vec3 P = vec3(rp.x * cos(phi), rp.x * sin(phi), side * h);
  // lit like the dusty flow the line guides: starlight with a softened falloff, shadowed inside the disk
  // (optical depth toward the star, as in the volume), scattered toward the observer
  float rs = max(length(P), 1e-3), Hs = H0 * pow(rp.x, 1.25);
  float tauStar = exp(clamp(LNTAU1 - 1.25 * log(rp.x) - 0.5 * h * h / (Hs * Hs), -30.0, 30.0));
  fade *= mix(0.2, 1.0, exp(-tauStar)) * phaseHG(dot(P / rs, normalize(uCam - P))) / (1.0 + rs * rs / 16.0);
  vec3 v = P - uCam;
  float z = dot(v, uBasis[2]);
  vec2 q = vec2(dot(v, uBasis[0]), dot(v, uBasis[1])) / (z * uTanHalf);
  q.x *= uRes.y / uRes.x;
  gl_Position = vec4(q, 0.0, 1.0);
  gl_PointSize = (k > 0.5 ? 3.0 : 1.0) * uPx;
  vFade = fade;
  vSide = side > 0.0 ? 1.0 : 0.4;
  vKind = k; vDepth = z;
}`;
  const LFS = `#version 300 es
precision highp float;
in float vFade; in float vSide; in float vKind; in float vDepth;
uniform sampler2D uOccl; uniform vec2 uRes; uniform float uGain;
out vec4 fragColor;
void main(){
  float a = vFade * vSide * uGain;
  if (vKind > 0.5) { vec2 d = gl_PointCoord - 0.5; a *= smoothstep(0.25, 0.0, dot(d, d)); }
  // hide what lies behind the opaque dust sheet; soften over a short range so lines do not pop at the edge
  float sd = texture(uOccl, gl_FragCoord.xy / uRes).a * 64.0;
  float behind = sd > 0.0 ? smoothstep(-0.15, 0.15, vDepth - sd) : 0.0;
  a *= 1.0 - 0.92 * behind;
  vec3 c = vKind > 0.5 ? vec3(0.78, 0.90, 1.0) : vec3(0.55, 0.72, 1.0);
  fragColor = vec4(c * a, 1.0);
}`;

  const reduceOS = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ja = () => document.documentElement.lang === 'ja';

  function init(box) {
    // data-static renders one frame (used for the fallback image and screenshots)
    const reduce = reduceOS || 'static' in box.dataset;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) { box.classList.add('disk-fallback'); return; }
    box.prepend(canvas);
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'disk-overlay'); overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<path class="disk-snowline" fill="none"/><text class="disk-label"></text>';
    box.appendChild(overlay);
    const ring = overlay.querySelector('path'), label = overlay.querySelector('text');

    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; for (const n of ['uRes', 'uTime', 'uCam', 'uBasis', 'uTanHalf', 'uRSnow', 'uExposure', 'uSteps', 'uSeed', 'uPx', 'uClump', 'uVapor', 'uMode']) U[n] = gl.getUniformLocation(prog, n);
    // --- field lines and wind particles: a second program drawn over the volume ---
    let showField = !('nofield' in box.dataset);
    const lprog = gl.createProgram();
    gl.attachShader(lprog, compile(gl.VERTEX_SHADER, LVS)); gl.attachShader(lprog, compile(gl.FRAGMENT_SHADER, LFS)); gl.linkProgram(lprog);
    if (!gl.getProgramParameter(lprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(lprog));
    const LU = {}; for (const n of ['uCam', 'uBasis', 'uTanHalf', 'uRes', 'uTime', 'uPx', 'uOccl', 'uGain']) LU[n] = gl.getUniformLocation(lprog, n);
    // the tabulated wind solution, shared by both programs
    const tab = new Float32Array(BP.XI.flatMap((x, i) => [x, BP.PHI[i], BP.TAU[i]]));
    gl.useProgram(lprog); gl.uniform3fv(gl.getUniformLocation(lprog, 'uTab'), tab);
    gl.useProgram(prog); gl.uniform3fv(gl.getUniformLocation(prog, 'uTab'), tab);
    // geometry: NL field lines with foot radii 0.2..6.5 au (log-spaced) and golden-angle azimuths; each line
    // is a strip of NS points in u = h / h_max; wind parcels carry a release phase in [0, 1).
    // Lower side: every other line and fewer parcels (weaker wind for an aligned field).
    const NL = 22, NS = 72, lineVerts = [], partVerts = [];
    for (let i = 0; i < NL; i++) {
      const Rf = 0.2 * Math.pow(6.5 / 0.2, (i + 0.5) / NL), phi0 = (i * 2.399963) % (2 * Math.PI);
      for (const kind of [0, 2]) {
        if (kind === 2 && i % 2) continue;
        for (let j = 0; j < NS; j++) { const u = j / (NS - 1); lineVerts.push(Rf, phi0, u, kind); if (j && j < NS - 1) lineVerts.push(Rf, phi0, u, kind); }
      }
      for (let m = 0; m < 8; m++) partVerts.push(Rf, phi0, ((m + 0.37 * i) / 8) % 1, 1);
      if (i % 2 === 0) for (let m = 0; m < 4; m++) partVerts.push(Rf, phi0, ((m + 0.21 * i) / 4) % 1, 3);
    }
    const lbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, lbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVerts), gl.STATIC_DRAW);
    const pbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(partVerts), gl.STATIC_DRAW);
    const lloc = gl.getAttribLocation(lprog, 'a');
    // the volume is rendered to a texture so the line pass can read its occlusion (alpha)
    const fbo = gl.createFramebuffer(), tex = gl.createTexture();
    const sizeTex = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); };
    // a trivial blit program copies the volume texture to the screen
    const BVS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
    const BFS = `#version 300 es
precision highp float; in vec2 uv; uniform sampler2D uTex; out vec4 o; void main(){ o = vec4(texture(uTex, uv).rgb, 1.0); }`;
    const bprog = gl.createProgram(); gl.attachShader(bprog, compile(gl.VERTEX_SHADER, BVS)); gl.attachShader(bprog, compile(gl.FRAGMENT_SHADER, BFS)); gl.linkProgram(bprog);
    if (!gl.getProgramParameter(bprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(bprog));
    const bloc = gl.getAttribLocation(bprog, 'p'), BU = gl.getUniformLocation(bprog, 'uTex');

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
      mode: Number(box.dataset.mode || 0)
    };
    const clumps = Array.from({ length: 6 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0, crossed: true }));
    const vapor = Array.from({ length: 4 }, () => ({ R: 0, phi: 0, t0: 0, amp: 0 }));
    let W = 0, Hh = 0, cam, basis, time = 0, last = 0, running = false, dragging = false, moved = false, px = 0, py = 0, azUser = opt.az, elUser = opt.el;
    const Omega = (R) => 0.5236 * Math.pow(R, -1.5);

    function camera() {
      const el = elUser, az = azUser + (reduce ? 0 : opt.spin * time);
      cam = [opt.dist * Math.cos(el) * Math.cos(az), opt.dist * Math.cos(el) * Math.sin(az), opt.dist * Math.sin(el)];
      const f = cam.map((c) => -c / opt.dist);
      const r = [f[1], -f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r[0] /= rl; r[1] /= rl;
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      basis = { f, r, u };
    }
    function project(p) {
      const v = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      const x = v[0] * basis.r[0] + v[1] * basis.r[1] + v[2] * basis.r[2];
      const y = v[0] * basis.u[0] + v[1] * basis.u[1] + v[2] * basis.u[2];
      const z = v[0] * basis.f[0] + v[1] * basis.f[1] + v[2] * basis.f[2];
      const th = Math.tan(opt.fov / 2);
      return [(x / (z * th * (W / Hh)) + 1) / 2 * W, (1 - y / (z * th)) / 2 * Hh, z];
    }
    function resize() {
      // the height follows data-aspect when given (the canvas's default size would otherwise set it)
      W = box.clientWidth; Hh = box.dataset.aspect ? Math.round(W * Number(box.dataset.aspect)) : (box.clientHeight || Math.round(W * 0.62));
      box.style.height = Hh + 'px';
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * opt.scale;
      canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(Hh * dpr));
      sizeTex();
      overlay.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      draw();
    }
    function draw() {
      if (!W) return;
      camera();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);                // uniforms below belong to the volume program (the line pass leaves its own bound)
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, time);
      gl.uniform3fv(U.uCam, cam);
      gl.uniformMatrix3fv(U.uBasis, false, [...basis.r, ...basis.u, ...basis.f]);
      gl.uniform1f(U.uTanHalf, Math.tan(opt.fov / 2));
      gl.uniform1f(U.uRSnow, opt.rSnow);
      gl.uniform1f(U.uExposure, opt.exposure);
      gl.uniform1i(U.uSteps, opt.steps);
      gl.uniform1f(U.uSeed, opt.seed);
      gl.uniform1f(U.uPx, canvas.width / W);
      gl.uniform4fv(U.uClump, clumps.flatMap((c) => [c.R, c.phi, c.t0, c.amp]));
      gl.uniform4fv(U.uVapor, vapor.flatMap((v) => [v.R, v.phi, v.t0, v.amp]));
      gl.uniform1i(U.uMode, opt.mode);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, showField ? fbo : null);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (showField) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.useProgram(bprog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(bloc); gl.vertexAttribPointer(bloc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(BU, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(lprog);
        gl.uniform3fv(LU.uCam, cam); gl.uniformMatrix3fv(LU.uBasis, false, [...basis.r, ...basis.u, ...basis.f]);
        gl.uniform1f(LU.uTanHalf, Math.tan(opt.fov / 2)); gl.uniform2f(LU.uRes, canvas.width, canvas.height);
        gl.uniform1f(LU.uTime, time); gl.uniform1f(LU.uPx, canvas.width / W); gl.uniform1i(LU.uOccl, 0);
        gl.uniform1f(LU.uGain, Number(box.dataset.field || 0.5));
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindBuffer(gl.ARRAY_BUFFER, lbuf); gl.enableVertexAttribArray(lloc); gl.vertexAttribPointer(lloc, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, lineVerts.length / 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.vertexAttribPointer(lloc, 4, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, partVerts.length / 4);
        gl.disable(gl.BLEND);
      }
      // snow line annotation, projected with the same camera
      let d = '', best = null;
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        const q = project([opt.rSnow * Math.cos(a), opt.rSnow * Math.sin(a), 0]);
        d += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
        if (!best || q[1] > best[1]) best = q;
      }
      ring.setAttribute('d', d + 'Z');
      label.textContent = ja() ? 'スノーライン' : 'snow line';
      label.setAttribute('x', best[0] + 8); label.setAttribute('y', best[1] + 14);
      canvas.setAttribute('aria-label', ja()
        ? '原始惑星系円盤の内側8 auのモデルを立体的に描いた図。表層は暖かく、赤道面は冷たく、ダストが赤道面に沈み、約1 auのスノーラインの外側で氷をまとっています。'
        : 'Volume rendering of a model protoplanetary disk within 8 au: warm surface layers, a cold midplane with settled dust, and a water snow line near 1 au.');
    }
    // a clump that crosses the snow line releases vapor
    function update() {
      for (const c of clumps) {
        if (c.amp <= 0) continue;
        const Rc = c.R - 0.05 * (time - c.t0);
        if (!c.crossed && Rc < opt.rSnow) {
          c.crossed = true;
          const tc = c.t0 + (c.R - opt.rSnow) / 0.05;
          const v = vapor.reduce((a, b) => (a.amp <= 0 || a.t0 < b.t0 ? a : b));
          v.R = 0.88 * opt.rSnow; v.phi = c.phi + Omega(opt.rSnow) * (tc - c.t0); v.t0 = tc; v.amp = c.amp;
        }
        if (Rc < 0.08 || time - c.t0 > 120) c.amp = 0;
      }
      for (const v of vapor) if (v.amp > 0 && time - v.t0 > 30) v.amp = 0;
    }
    function frame(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t; time += dt;
      update();
      draw();
      requestAnimationFrame(frame);
    }
    const start = () => { if (!reduce && !running) { running = true; last = 0; requestAnimationFrame(frame); } };
    const stop = () => { running = false; };
    const addClump = (R, phi, age) => {
      const c = clumps.reduce((a, b) => (a.amp <= 0 ? a : b.amp <= 0 ? b : a.t0 < b.t0 ? a : b));
      c.R = R; c.phi = phi; c.t0 = time - (age || 0); c.amp = 1; c.crossed = R - 0.05 * (age || 0) < opt.rSnow;
    };

    canvas.addEventListener('pointerdown', (e) => { dragging = true; moved = false; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      azUser -= dx * 0.006; elUser = Math.min(1.45, Math.max(0.08, elUser + dy * 0.006)); px = e.clientX; py = e.clientY;
      if (reduce) draw();
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      if (moved) return;
      // click: drop pebbles where the ray meets the midplane
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      const th = Math.tan(opt.fov / 2), asp = W / Hh;
      const rd = [0, 1, 2].map((i) => basis.f[i] + th * (nx * asp * basis.r[i] + ny * basis.u[i]));
      const t = -cam[2] / rd[2]; if (t <= 0) return;
      const x = cam[0] + rd[0] * t, y = cam[1] + rd[1] * t, R = Math.hypot(x, y);
      if (R < 0.15 || R > 8.3) return;
      addClump(R, Math.atan2(y, x), 0);
      if (reduce) draw();
    });
    new ResizeObserver(resize).observe(box);
    new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? start() : stop()))).observe(box);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    resize();
    box.diskSetTime = (t) => { time = t; update(); draw(); };
    box.diskAddClump = (R, phi, age) => { addClump(R, phi, age); draw(); };
    // controls for the preview page: camera presets (degrees, au) and the field-line overlay
    box.diskView = (elevationDeg, azimuthDeg, distance) => { elUser = elevationDeg * Math.PI / 180; azUser = azimuthDeg * Math.PI / 180 - (reduce ? 0 : opt.spin * time); if (distance) opt.dist = distance; draw(); };
    box.diskField = (on) => { showField = on; draw(); };
  }
  // Panels narrower than 700 px keep the static picture: a finger drag would fight page scrolling,
  // and phone GPUs should not pay for the ray march.
  const phone = window.matchMedia('(max-width: 699px)').matches;
  // A panel with data-mobile opts in to WebGL on narrow screens (used by the preview page).
  document.querySelectorAll('[data-disk3d]').forEach((box) => { if (phone && !('mobile' in box.dataset)) { box.classList.add('disk-fallback'); return; } try { init(box); } catch (e) { box.classList.add('disk-fallback'); console.error(e); } });
})();
