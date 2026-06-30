export default function Footer({ data }) {
  return (
    <footer className="mt-16 border-t border-(--rule) bg-[color-mix(in_srgb,var(--bg)_94%,white)] relative z-10">
      <div className="max-w-[1180px] mx-auto px-6 py-10">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          <div className="max-w-[34rem]">
            <a href="/" className="font-display inline-flex items-center gap-3 font-semibold text-[1.05rem] text-(--fg)">
              <img src="/assets/app-icon.png" alt="" className="w-8 h-8 rounded-[9px]" />
              <span>Trailhead</span>
            </a>
            <p className="mt-4 text-[0.95rem] leading-6 text-(--fg-muted)">{data.blurb}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
            {data.columns.map((col) => (
              <div key={col.title}>
                <h5 className="font-display text-[0.82rem] font-bold text-(--fg-muted) mb-3">{col.title}</h5>
                {col.links.map((l) => (
                  <a key={l.href} href={l.href} className="font-display block py-1.5 text-[0.95rem] hover:text-(--accent)">
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-(--rule) flex justify-between items-center text-[0.76rem] text-(--fg-muted)">
          <span>{data.copyright}</span>
          <span>Trailhead</span>
        </div>
      </div>
    </footer>
  );
}
