import { motion } from 'framer-motion';

const parent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const child = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] } },
};

export default function Footer({ data }) {
  return (
    <footer className="mt-24 pt-16 pb-10 border-t border-(--rule) relative z-10">
      <div className="max-w-[1440px] mx-auto px-5 md:px-14">
        <motion.div
          className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr] gap-8 mb-12"
          variants={parent}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
        >
          <motion.div className="col-span-2 md:col-span-1" variants={child}>
            <h4 className="font-display font-medium tracking-[-0.035em] leading-[0.95] text-[clamp(2rem,5vw,4rem)]">
              {data.headline.lead}{' '}
              <span className="font-serif-i">{data.headline.italic}</span>
              <br />
              {data.headline.tail}
            </h4>
            <p className="font-serif mt-4 max-w-[32ch] text-(--fg-muted)">{data.blurb}</p>
          </motion.div>
          {data.columns.map((col, i) => (
            <motion.div key={i} variants={child}>
              <h5 className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-(--fg-muted) mb-5">
                {col.title}
              </h5>
              {col.links.map((l, j) => (
                <motion.a
                  key={j}
                  href={l.href}
                  className="font-display block py-1.5 text-[0.95rem] hover:text-(--accent)"
                  whileHover={{ paddingLeft: 6 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                >
                  {l.label}
                </motion.a>
              ))}
            </motion.div>
          ))}
        </motion.div>
        <div className="pt-8 border-t border-(--rule) flex justify-between items-center font-mono text-[0.7rem] tracking-[0.08em] text-(--fg-muted)">
          <span>{data.copyright}</span>
          <span>◉ In the field</span>
        </div>
      </div>
    </footer>
  );
}
