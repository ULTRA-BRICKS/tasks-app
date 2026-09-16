import { useId, type ReactNode } from 'react';

/** One layout for login, invitation and account recovery; credentials remain in their page. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const heading = useId();
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby={heading}>
        <div className="auth-brand">
          <img src="/favicon.svg" width="32" height="32" alt="" />
          <span>Tasks</span>
        </div>
        <header className="auth-heading">
          <h1 id={heading}>{title}</h1>
          {description && <p className="auth-intro">{description}</p>}
        </header>
        <div className="auth-content">{children}</div>
        {footer && <footer className="auth-footer">{footer}</footer>}
      </section>
    </main>
  );
}
