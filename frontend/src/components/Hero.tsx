import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type CSSProperties } from "react";

// Hero in the style of Aceternity UI: aurora background, spotlight, words that fade in
// and a screenshot card that tilts upright while you scroll ("container scroll").
// The fade-ins are CSS animations, so the text shows without JavaScript too.
type Props = { title: string; lead: string; image: string; imageAlt: string; repoUrl: string };

const CHIPS = [
  { text: "3 sensors: salt, turbidity, pH", color: "var(--tds)" },
  { text: "warns on site, even offline", color: "var(--yellow)" },
  { text: "SMS to the right people", color: "var(--red)" },
  { text: "a person resets", color: "var(--ok)" },
];

const delay = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

export default function Hero({ title, lead, image, imageAlt, repoUrl }: Props) {
  const still = useReducedMotion() ?? false;
  const card = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: card, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [still ? 0 : 24, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [still ? 1 : 0.92, 1]);

  return (
    <section className="hero2">
      <div className="aurora" aria-hidden="true" />
      <svg className="spotlight" viewBox="0 0 3787 2842" fill="none" aria-hidden="true">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill="url(#spot)"
          fillOpacity="0.2"
        />
        <defs>
          <radialGradient id="spot">
            <stop offset="0" stopColor="var(--spot)" />
            <stop offset="1" stopColor="var(--spot)" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      <div className="wrap hero2-inner">
        <p className="pill reveal">Hackathon prototype · BCG Platinion · Fighting World Hunger 2026</p>
        <h1 className="hero2-title">
          {title.split(" ").map((word, i) => [
            i > 0 && " ",
            <span key={word} className="reveal blur" style={delay(0.15 + i * 0.12)}>
              {word}
            </span>,
          ])}
        </h1>
        <p className="lead hero2-lead reveal" style={delay(0.55)}>
          {lead}
        </p>
        <div className="buttons hero2-buttons reveal" style={delay(0.7)}>
          <a className="btn primary shimmer" href="#station">
            See how it works
          </a>
          <a className="btn" href="#demo">
            Try the dashboard
          </a>
          <a className="btn ghost" href={repoUrl}>
            Code on GitHub
          </a>
        </div>
        <ul className="hero2-chips reveal" style={delay(0.85)}>
          {CHIPS.map((c) => (
            <li key={c.text}>
              <span style={{ background: c.color }} />
              {c.text}
            </li>
          ))}
        </ul>

        <div className="scroll-card-stage" ref={card}>
          <motion.div className="scroll-card" style={{ rotateX, scale }}>
            <img src={image} width={1280} height={720} alt={imageAlt} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
