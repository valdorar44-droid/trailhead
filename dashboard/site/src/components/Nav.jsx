import { useState } from 'react';

export default function Nav({ brand, links, active, transparent = false }) {
  const [open, setOpen] = useState(false);

  const base = transparent
    ? 'nav-transparent bg-transparent border-transparent text-white'
    : 'bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] border-b border-[var(--rule)] backdrop-blur-xl text-[var(--fg)]';

  const linkBase = transparent ? 'text-white/90 hover:text-[var(--accent)]' : 'text-[var(--fg)] hover:text-[var(--accent)]';

  return (
    <nav className={`${transparent ? '' : 'sticky top-0'} z-50 ${base}`}>
      <div className="max-w-[1440px] mx-auto px-5 md:px-14 relative z-10">
        <div className="flex items-center justify-between py-[1.1rem]">
          <a href="/" className={`font-display flex items-center gap-3 font-semibold tracking-tight text-[1.05rem] ${transparent ? '' : 'text-(--fg)'}`}>
            <img src="/assets/app-icon.png" alt="" className="w-8 h-8 rounded-[9px] shadow-[0_10px_22px_rgba(45,38,30,.16)]" />
            <span>
              {brand.name}
              {brand.mark && <sup className="ml-0.5 text-[0.55em] opacity-60">{brand.mark}</sup>}
            </span>
          </a>

          <div className="flex gap-6 md:gap-10 items-center">
            {links.map((l) => {
              const isActive = active === l.href;
              return (
                <a
                  key={l.href}
                  href={l.href}
                  className={`group font-display relative py-1.5 text-[0.9rem] font-medium transition-colors hidden md:inline-block ${linkBase} ${isActive ? (transparent ? '!text-[var(--accent)]' : 'text-[var(--accent)]') : ''}`}
                >
                  {l.label}
                  <span
                    className={`nav-link-underline absolute left-0 bottom-0 h-px transition-all duration-300 ${isActive ? 'w-full' : 'w-0 group-hover:w-full'}`}
                  ></span>
                </a>
              );
            })}
            <button
              onClick={() => setOpen((o) => !o)}
              aria-label="Menu"
              aria-expanded={open}
              className="nav-btn md:hidden w-10 h-10 rounded-full grid place-items-center"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                {open ? (
                  <path d="M18 6L6 18M6 6l12 12" />
                ) : (
                  <>
                    <path d="M3 6h18" />
                    <path d="M3 12h18" />
                    <path d="M3 18h18" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {open && (
          <div className={`md:hidden absolute left-0 right-0 top-full ${transparent ? 'bg-black/95 border-t border-(--accent)' : 'bg-[var(--bg)] border-t border-[var(--rule)]'} shadow-[0_30px_60px_-30px_rgba(0,0,0,0.4)]`}>
            <div className="flex flex-col px-5 py-4">
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`font-display py-3 text-[1rem] font-medium border-b ${transparent ? 'border-white/10 text-white' : 'border-[var(--rule)] text-[var(--fg)]'} last:border-0 ${active === l.href ? 'text-[var(--accent)]' : ''}`}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
