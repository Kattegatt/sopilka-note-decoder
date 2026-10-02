import { useEffect, useRef, useState } from "react";
import type { CachedAccount } from "./storage";
import type { SyncStatus } from "./sync";
import { apiFetch } from "./sync";

type Mode = "login" | "register";
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
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  function changeMode(next: Mode) {
    setMode(next); setPassword(""); setConfirm(""); setFailure("");
  }
  function close() { setOpen(false); setPassword(""); setConfirm(""); }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setFailure("");
    if (mode === "register" && password !== confirm) {
      setFailure("Паролі не збігаються."); return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST", body: JSON.stringify({ login, password }),
      });
      await onSession(); close();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Не вдалося виконати запит.");
    } finally { setBusy(false); }
  }

  return <div className="account-controls">
    <span className={`sync-status ${status}`} role="status" title={message || undefined}>
      {ready ? labels[status] : "Відкриваємо ноти…"}
    </span>
    {message && <span className="sync-message" role="alert">{message}</span>}
    {account && <span className="account-login" title={account.login}>{account.login}</span>}
    {(!account || status === "login") && <button type="button" disabled={!ready} onClick={() => {
      changeMode("login"); setLogin(account?.login ?? ""); setOpen(true);
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
      <h2 id="auth-heading">{mode === "login" ? "Вхід" : "Реєстрація"}</h2>
      <p>Акаунт дозволяє зберігати ноти між пристроями. Без реєстрації вони залишаються в цьому браузері.</p>
      {mode === "register" && <p>Після реєстрації всі локальні мелодії автоматично додадуться до акаунта.</p>}
      <form onSubmit={submit}>
        <label>Логін<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
          required minLength={3} maxLength={30} pattern={"[A-Za-z0-9_.\\-]{3,30}"}
          aria-describedby="login-help" value={login} onChange={(event) => setLogin(event.target.value)} /></label>
        <small id="login-help">3–30 латинських літер, цифр, крапок, дефісів або підкреслень.</small>
        <label>Пароль<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
          required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {mode === "register" && <label>Повторіть пароль<input type="password" autoComplete="new-password"
          required minLength={8} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>}
        {failure && <p className="auth-error" role="alert">{failure}</p>}
        <button type="submit" disabled={busy}>{busy ? "Зачекайте…" : mode === "login" ? "Увійти" : "Зареєструватися"}</button>
      </form>
      <div className="auth-links">
        <button type="button" disabled={busy} onClick={() => changeMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Створити акаунт" : "Увійти"}
        </button>
      </div>
    </dialog>
  </div>;
}
