import { useEffect, useRef, useState } from "react";
import type { CachedAccount } from "./storage";
import type { SyncStatus } from "./sync";
import { apiFetch } from "./sync";

type Mode = "login" | "register" | "forgot" | "reset" | "verify";
const labels: Record<SyncStatus, string> = {
  local: "Збережено на пристрої", syncing: "Синхронізація…", synced: "Синхронізовано",
  offline: "Офлайн · збережено на пристрої", login: "Потрібен вхід", error: "Помилка збереження",
};

export function AccountControls({ account, status, message, ready, onSession, onLogout }: {
  account: CachedAccount | null;
  status: SyncStatus;
  message: string;
  ready: boolean;
  onSession(): Promise<void>;
  onLogout(): Promise<void>;
}) {
  const [initialToken] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const resetToken = useRef(initialToken);
  const [open, setOpen] = useState(Boolean(initialToken));
  const [mode, setMode] = useState<Mode>(initialToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failure, setFailure] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);
  useEffect(() => {
    if (resetToken.current) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  function changeMode(next: Mode) {
    setMode(next); setPassword(""); setConfirm(""); setFeedback(""); setFailure("");
  }
  function close() { setOpen(false); setPassword(""); setConfirm(""); }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(""); setFeedback("");
    if ((mode === "register" || mode === "reset") && password !== confirm) {
      setFailure("Паролі не збігаються."); return;
    }
    setBusy(true);
    try {
      const callbackURL = `${window.location.origin}/`;
      if (mode === "register") {
        await apiFetch("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({
          name: email.split("@")[0], email, password, callbackURL,
        }) });
        changeMode("verify");
        setFeedback("Лист надіслано. Підтвердіть email, щоб увімкнути синхронізацію нот.");
      } else if (mode === "verify") {
        await apiFetch("/api/auth/send-verification-email", { method: "POST", body: JSON.stringify({ email, callbackURL }) });
        setFeedback("Лист підтвердження надіслано повторно.");
      } else if (mode === "forgot") {
        await apiFetch("/api/auth/request-password-reset", { method: "POST", body: JSON.stringify({ email, redirectTo: callbackURL }) });
        setFeedback("Якщо акаунт із цією поштою існує, ви отримаєте лист для відновлення пароля.");
      } else if (mode === "reset") {
        await apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify({
          token: resetToken.current, newPassword: password,
        }) });
        resetToken.current = null;
        changeMode("login");
        setFeedback("Пароль змінено. Увійдіть із новим паролем.");
        await onSession();
      } else {
        await apiFetch("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password, rememberMe: true }) });
        await onSession(); close();
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Не вдалося виконати запит.");
    } finally { setBusy(false); }
  }

  return <div className="account-controls">
    <span className={`sync-status ${status}`} role="status" title={message || undefined}>
      {ready ? labels[status] : "Відкриваємо ноти…"}
    </span>
    {message && <span className="sync-message" role="alert">{message}</span>}
    {account && <span className="account-email" title={account.email}>{account.email}</span>}
    {(!account || status === "login") && <button type="button" disabled={!ready} onClick={() => {
      changeMode("login"); setEmail(account?.email ?? ""); setOpen(true);
    }}>{account ? "Увійти" : "Увійти / Зареєструватися"}</button>}
    {account && <button type="button" disabled={busy || !ready} onClick={async () => {
      setBusy(true);
      try { await onLogout(); } catch (error) {
        setFailure(error instanceof Error ? error.message : "Не вдалося вийти.");
      } finally { setBusy(false); }
    }}>Вийти</button>}
    {(status === "error" || status === "offline") && <button type="button" onClick={() => void onSession()}>Повторити</button>}
    <dialog ref={dialogRef} className="auth-dialog" onCancel={close} onClose={close} aria-labelledby="auth-heading">
      <button className="auth-close" type="button" onClick={close} aria-label="Закрити">×</button>
      <h2 id="auth-heading">{{ login: "Вхід", register: "Реєстрація", forgot: "Відновлення пароля", reset: "Новий пароль", verify: "Підтвердження email" }[mode]}</h2>
      <p>Акаунт дозволяє зберігати ноти між пристроями. Без реєстрації вони залишаються в цьому браузері.</p>
      {mode === "register" && <p>Після підтвердження email всі локальні мелодії автоматично додадуться до акаунта.</p>}
      <form onSubmit={submit}>
        {mode !== "reset" && <label>Email<input type="email" autoComplete="email" required maxLength={254}
          value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
        {(mode === "login" || mode === "register" || mode === "reset") && <label>Пароль<input type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} maxLength={128}
          value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {(mode === "register" || mode === "reset") && <label>Повторіть пароль<input type="password" autoComplete="new-password"
          required minLength={8} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>}
        {failure && <p className="auth-error" role="alert">{failure}</p>}
        {feedback && <p role="status">{feedback}</p>}
        <button type="submit" disabled={busy}>{busy ? "Зачекайте…" : {
          login: "Увійти", register: "Зареєструватися", forgot: "Надіслати лист", reset: "Змінити пароль", verify: "Надіслати лист повторно",
        }[mode]}</button>
      </form>
      <div className="auth-links">
        {mode !== "login" && <button type="button" disabled={busy} onClick={() => changeMode("login")}>Увійти</button>}
        {mode === "login" && <>
          <button type="button" onClick={() => changeMode("register")}>Створити акаунт</button>
          <button type="button" onClick={() => changeMode("forgot")}>Забули пароль?</button>
          <button type="button" onClick={() => changeMode("verify")}>Підтвердити email</button>
        </>}
      </div>
    </dialog>
  </div>;
}
