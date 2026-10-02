/**
 * Bloqueo local con Face ID / Touch ID / huella (WebAuthn, autenticador de la plataforma).
 *
 * Qué es: un candado de PRIVACIDAD en este dispositivo, como el bloqueo de la app del banco.
 * Cada vez que la app pasa a segundo plano se tapa el contenido, y al volver pide Face ID.
 * Qué NO es: no reemplaza la contraseña ni el doble factor. La sesión y los datos los protegen
 * Supabase Auth + RLS (+ TOTP si está activo). Si alguien tiene acceso al código de la página
 * (devtools en una compu desbloqueada) podría quitar el candado; por eso es una capa extra.
 *
 * Se guarda solo el ID de la credencial y la clave pública (no son secretos). La biometría
 * nunca sale del dispositivo: el navegador solo informa "el usuario se verificó".
 */

const KEY = "fp:lock";

export interface LockConfig {
  credId: string; // base64url
  publicKey?: string; // SPKI base64url (para verificar la firma localmente)
  alg?: number;
  createdAt: string;
}

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export function getLock(): LockConfig | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.credId === "string" ? v : null;
  } catch {
    return null;
  }
}

export function clearLock() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  document.documentElement.removeAttribute("data-locked");
}

export async function lockAvailable(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Registra Face ID para este dispositivo. Lanza error si el usuario cancela. */
export async function enrollLock(label: string): Promise<LockConfig> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Mis Finanzas", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: label || "Mis Finanzas", displayName: "Mis Finanzas" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      attestation: "none",
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No se creó la credencial.");
  const r = cred.response as AuthenticatorAttestationResponse;
  const pk = typeof r.getPublicKey === "function" ? r.getPublicKey() : null;
  const cfg: LockConfig = {
    credId: b64u(cred.rawId),
    publicKey: pk ? b64u(pk) : undefined,
    alg: typeof r.getPublicKeyAlgorithm === "function" ? r.getPublicKeyAlgorithm() : undefined,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg;
}

/** DER (ECDSA) -> firma "raw" r||s de 64 bytes que espera WebCrypto */
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => {
    if (der[i] !== 0x02) throw new Error("firma");
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read(), s = read();
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

/**
 * Pide Face ID. Devuelve true solo si:
 *  - respondió la credencial registrada,
 *  - el autenticador marcó "usuario verificado" (UV, flag 0x04), y
 *  - la firma sobre nuestro desafío aleatorio es válida con la clave pública guardada.
 */
export async function unlockWithBiometrics(cfg: LockConfig): Promise<boolean> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: fromB64u(cfg.credId), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred || b64u(cred.rawId) !== cfg.credId) return false;
  const r = cred.response as AuthenticatorAssertionResponse;
  const authData = new Uint8Array(r.authenticatorData);
  if (!(authData[32] & 0x04)) return false; // UV

  const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
  if (client.type !== "webauthn.get" || client.challenge !== b64u(challenge) || client.origin !== location.origin) return false;

  if (!cfg.publicKey) return true; // navegadores viejos sin getPublicKey(): alcanza con UV
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", r.clientDataJSON));
  const signed = new Uint8Array(authData.length + hash.length);
  signed.set(authData);
  signed.set(hash, authData.length);
  const sig = new Uint8Array(r.signature);
  if (cfg.alg === -257) {
    const key = await crypto.subtle.importKey("spki", fromB64u(cfg.publicKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
  }
  const key = await crypto.subtle.importKey("spki", fromB64u(cfg.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed);
}

/** Script que corre ANTES del primer pintado: si hay candado, la app arranca tapada. */
export const LOCK_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(KEY)})&&location.pathname!=="/login")document.documentElement.setAttribute("data-locked","1")}catch(e){}`;
