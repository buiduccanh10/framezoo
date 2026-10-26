import { AlertCircle, ArrowUpRight, Loader2, LockKeyhole } from "lucide-react";
import { useState } from "react";

interface LoginScreenProps {
  busy: boolean;
  error: string;
  onSubmit: (username: string, password: string) => void;
}

export function LoginScreen({ busy, error, onSubmit }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-kicker">
          <LockKeyhole size={15} aria-hidden="true" />
          <span>Restricted workspace</span>
        </div>
        <img src="/framezoo-logo.svg" alt="Framezoo" className="auth-logo" />
        <h1 id="login-title">Framezoo admin</h1>
        <p className="auth-lede">Quản trị người dùng, phản hồi và bản sao lưu.</p>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(username.trim(), password);
          }}
        >
          <label>
            <span>Tài khoản</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              maxLength={128}
              autoFocus
            />
          </label>
          <label>
            <span>Mật khẩu</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={256}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              {error}
            </p>
          )}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>
            {busy ? <Loader2 size={17} className="spin" /> : <ArrowUpRight size={17} />}
            {busy ? "Đang xác thực" : "Vào workspace"}
          </button>
        </form>

        <p className="auth-footnote">Phiên quản trị chỉ tồn tại trong cookie HTTP-only.</p>
      </section>
    </main>
  );
}
