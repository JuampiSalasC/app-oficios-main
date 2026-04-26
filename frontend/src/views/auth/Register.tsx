import { logger } from "../../utils/logger";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  FacebookAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
} from "firebase/auth";
import { auth } from "../../firebase";
import config from "../../config";

import facebookIcon from "../../assets/img/facebook.svg";
import googleIcon from "../../assets/img/google.svg";
import { subirImagenPerfil } from "../../utils/subirImagenPerfil";
import { useAuth } from "../../context/AuthContext";
import { JSX } from "react/jsx-runtime";

const Register = (): JSX.Element => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Paso del registro: "form" = llenando datos, "sms" = esperando código
  const [step, setStep] = useState<"form" | "sms">("form");

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tipo, setTipo] = useState<"cliente" | "profesional">("cliente");
  const [zonas, setZonas] = useState<string[]>([]);
  const [subcategoriasSeleccionadas, setSubcategoriasSeleccionadas] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [zonasDisponibles, setZonasDisponibles] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [telefono, setTelefono] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState<string>("");
  const [disponibilidad, setDisponibilidad] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  // Guardamos el usuario de Firebase para usarlo después de confirmar el SMS
  const firebaseUserRef = useRef<any>(null);

  const { setUsuario } = useAuth();

  useEffect(() => {
    auth.signOut();
  }, []);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/utils/zonas`).then(r => r.json()).then(setZonasDisponibles);
    fetch(`${config.apiBaseUrl}/utils/categorias`).then(r => r.json()).then(setCategorias);
  }, []);

  const handleFotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFoto(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  // Paso 1: validar datos, crear cuenta Firebase y enviar SMS
  const handleRegistro = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!telefono) { setError("El teléfono es obligatorio"); return; }
    if (!/^\+\d{7,15}$/.test(telefono.replace(/\s/g, ""))) {
      setError("El número debe incluir el código de país. Ej: +5491162192097");
      return;
    }

    setLoading(true);
    try {
      // 1) Crear cuenta con email/contraseña
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      firebaseUserRef.current = cred.user;
      setUsuario?.(cred.user);

      // 2) Enviar SMS al teléfono
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, "recaptcha-anchor", { size: "invisible" });
      }
      await recaptchaVerifierRef.current.render();
      const provider = new PhoneAuthProvider(auth);
      const vid = await provider.verifyPhoneNumber(telefono, recaptchaVerifierRef.current);
      setVerificationId(vid);

      // 3) Mostrar pantalla de código SMS
      setStep("sms");
    } catch (err: any) {
      logger.error("Error al registrar", err);
      setError(t("error_registrar", { detalle: err.message }));
      recaptchaVerifierRef.current?.clear();
      recaptchaVerifierRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  // Paso 2: confirmar código SMS y guardar perfil en backend
  const handleConfirmarCodigo = async () => {
    if (!smsCode || smsCode.length < 6) { setError("Ingresá el código de 6 dígitos"); return; }
    if (!verificationId || !firebaseUserRef.current) return;

    setLoading(true);
    setError("");
    try {
      // 1) Vincular teléfono verificado a la cuenta Firebase
      const phoneCredential = PhoneAuthProvider.credential(verificationId, smsCode);
      await linkWithCredential(firebaseUserRef.current, phoneCredential);

      // 2) Subir foto si hay
      const token = await firebaseUserRef.current.getIdToken();
      let fotoPerfil = null;
      if (foto) fotoPerfil = await subirImagenPerfil(foto, firebaseUserRef.current.uid);

      // 3) Guardar perfil en backend
      const payload: any = {
        id: firebaseUserRef.current.uid,
        nombre,
        tipo,
        foto: fotoPerfil,
        descripcion,
        disponibilidad,
        telefono,
      };
      if (tipo === "profesional") {
        if (zonas.length === 0 || subcategoriasSeleccionadas.length === 0) {
          throw new Error(t("error_zonas_subcategorias"));
        }
        payload.zonas = zonas;
        payload.subcategorias = subcategoriasSeleccionadas;
      }

      const res = await fetch(`${config.apiBaseUrl}/usuarios/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(t("error_guardar_backend"));

      navigate("/");
      navigate(0);
    } catch (err: any) {
      logger.error("Error al confirmar código", err);
      setError(t("error_registrar", { detalle: err.message }));
    } finally {
      setLoading(false);
    }
  };

  const handleSocialSignup = async (provider: any) => {
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const token = await user.getIdToken();
      const res = await fetch(`${config.apiBaseUrl}/usuarios/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const userData = await res.json();
        navigate(userData?.id ? "/" : "/auth/completar-perfil");
      } else if (res.status === 404 || res.status === 401) {
        navigate("/auth/completar-perfil");
      } else {
        setError(t("error_verificar_usuario"));
      }
    } catch (err) {
      logger.error("Error en registro", err);
      setError(t("error_registro_red_social"));
    }
  };

  // ── Pantalla de verificación SMS ──────────────────────────────────────────
  if (step === "sms") {
    return (
      <div className="container mx-auto px-4 h-full">
        <div className="flex content-center items-center justify-center h-full">
          <div className="w-full lg:w-4/12 px-4">
            <div className="relative flex flex-col min-w-0 break-words w-full mb-6 shadow-lg rounded-lg bg-blueGray-200 border-0">
              <div className="flex-auto px-4 lg:px-10 py-10">
                <div className="text-center mb-6">
                  <h6 className="text-blueGray-700 text-lg font-bold">📱 {t("verificar_telefono")}</h6>
                  <p className="text-blueGray-500 text-sm mt-2">
                    Ingresá el código de 6 dígitos que enviamos a<br />
                    <strong>{telefono}</strong>
                  </p>
                </div>

                {error && <p className="text-red-500 text-center mb-4 text-sm">{error}</p>}

                <input
                  type="text"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  className="border-0 px-3 py-3 text-center text-2xl tracking-widest placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full mb-4"
                  placeholder="------"
                  autoFocus
                />

                <button
                  onClick={handleConfirmarCodigo}
                  disabled={loading || smsCode.length < 6}
                  className="bg-blueGray-800 text-white active:bg-blueGray-600 text-sm font-bold uppercase px-6 py-3 rounded shadow hover:shadow-lg outline-none focus:outline-none w-full ease-linear transition-all duration-150 disabled:opacity-50"
                >
                  {loading ? t("cargando") : t("confirmar_codigo")}
                </button>

                <button
                  onClick={() => { setStep("form"); setError(""); setSmsCode(""); }}
                  className="mt-3 text-blueGray-500 text-sm w-full text-center underline"
                  type="button"
                >
                  {t("volver_atras")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Formulario de registro ────────────────────────────────────────────────
  return (
    <div className="container mx-auto px-4 h-full">
      <div className="flex content-center items-center justify-center h-full">
        <div className="w-full lg:w-6/12 px-4">
          <div className="relative flex flex-col min-w-0 break-words w-full mb-6 shadow-lg rounded-lg bg-blueGray-200 border-0">
            <div className="rounded-t mb-0 px-6 py-6">
              <div className="text-center mb-3">
                <h6 className="text-blueGray-500 text-sm font-bold">{t("registrarse_con")}</h6>
              </div>
              <div className="btn-wrapper text-center">
                <button
                  onClick={() => handleSocialSignup(new FacebookAuthProvider())}
                  className="bg-white active:bg-blueGray-50 text-blueGray-700 font-normal px-4 py-2 rounded outline-none focus:outline-none mr-2 mb-1 uppercase shadow hover:shadow-md inline-flex items-center font-bold text-xs ease-linear transition-all duration-150"
                  type="button"
                >
                  <img alt="Facebook" className="w-5 mr-1" src={facebookIcon} />
                  Facebook
                </button>
                <button
                  onClick={() => handleSocialSignup(new GoogleAuthProvider())}
                  className="bg-white active:bg-blueGray-50 text-blueGray-700 font-normal px-4 py-2 rounded outline-none focus:outline-none mr-1 mb-1 uppercase shadow hover:shadow-md inline-flex items-center font-bold text-xs ease-linear transition-all duration-150"
                  type="button"
                >
                  <img alt="Google" className="w-5 mr-1" src={googleIcon} />
                  Google
                </button>
              </div>
              <hr className="mt-6 border-b-1 border-blueGray-300" />
            </div>

            <div className="flex-auto px-4 lg:px-10 py-10 pt-0">
              <div className="text-blueGray-400 text-center mb-3 font-bold">
                <small>{t("registrarse_con_credenciales")}</small>
              </div>
              {error && <p className="text-red-500 text-center mb-3 text-sm">{error}</p>}

              <form onSubmit={handleRegistro}>
                <div className="relative w-full mb-3">
                  <label htmlFor="nombre" className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("nombre")}</label>
                  <input id="nombre" type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
                    className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150"
                    placeholder={t("nombre")} required />
                </div>

                <div className="relative w-full mb-3">
                  <label htmlFor="email" className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("email")}</label>
                  <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150"
                    placeholder={t("email")} required />
                </div>

                <div className="relative w-full mb-3">
                  <label htmlFor="telefono" className="block uppercase text-blueGray-600 text-xs font-bold mb-2">
                    {t("telefono")} *
                  </label>
                  <input id="telefono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)}
                    className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150"
                    placeholder="Ej: +5491162192097" required />
                  <p className="text-blueGray-400 text-xs mt-1">Incluí el código de país. Para Argentina: +549...</p>
                </div>

                <div className="relative w-full mb-3">
                  <label htmlFor="foto" className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("foto_perfil")}</label>
                  {preview && <img src={preview} alt="Preview" className="mb-3 rounded-full shadow-md w-20 h-20 object-cover mx-auto" />}
                  <input id="foto" type="file" accept="image/*" onChange={handleFotoChange}
                    className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150" />
                </div>

                <div className="relative w-full mb-3">
                  <label htmlFor="password" className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("password")}</label>
                  <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150"
                    placeholder="********" required />
                </div>

                <div className="relative w-full mb-3">
                  <label htmlFor="tipo" className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("tipo_usuario")}</label>
                  <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "cliente" | "profesional")}
                    className="w-full mb-3 p-3 bg-white text-blueGray-600 rounded text-sm shadow">
                    <option value="cliente">{t("cliente")}</option>
                    <option value="profesional">{t("profesional")}</option>
                  </select>
                </div>

                {tipo === "profesional" && (
                  <>
                    <label className="block mb-1 font-medium">{t("zonas")}</label>
                    <select multiple className="w-full mb-3 p-2 border rounded"
                      onChange={(e) => setZonas(Array.from(e.target.selectedOptions, o => o.value))}>
                      {zonasDisponibles.map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>

                    <label className="block mb-1 font-medium">{t("categoria")}</label>
                    <select multiple className="w-full mb-3 p-2 border rounded"
                      value={subcategoriasSeleccionadas}
                      onChange={e => setSubcategoriasSeleccionadas(Array.from(e.target.selectedOptions, o => o.value))}>
                      {categorias.map((cat) => (
                        <optgroup key={cat.id} label={cat.nombre}>
                          {cat.subcategorias.map((sc: { nombre: string }) => (
                            <option key={`${cat.nombre}-${sc.nombre}`} value={sc.nombre}>{sc.nombre}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>

                    <div className="relative w-full mb-3">
                      <label className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("descripcion")}</label>
                      <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                        className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150" />
                    </div>

                    <div className="relative w-full mb-3">
                      <label className="block uppercase text-blueGray-600 text-xs font-bold mb-2">{t("disponibilidad")}</label>
                      <input type="text" value={disponibilidad} onChange={(e) => setDisponibilidad(e.target.value)}
                        className="border-0 px-3 py-3 placeholder-blueGray-300 text-blueGray-600 bg-white rounded text-sm shadow focus:outline-none focus:ring w-full ease-linear transition-all duration-150" />
                    </div>
                  </>
                )}

                {/* div invisible para el reCAPTCHA de Firebase */}
                <div id="recaptcha-anchor" />

                <div className="text-center mt-6">
                  <button type="submit" disabled={loading}
                    className="bg-blueGray-800 text-white active:bg-blueGray-600 text-sm font-bold uppercase px-6 py-3 rounded shadow hover:shadow-lg outline-none focus:outline-none mr-1 mb-1 w-full ease-linear transition-all duration-150 disabled:opacity-50">
                    {loading ? t("cargando") : t("crear_cuenta")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
