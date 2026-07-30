/**
 * zapclub.io — cross promotion under the growth chart.
 *
 * Deliberately styled in zapclub's own palette rather than the factory's neon
 * green: it is someone else's front door, and a banner that wears the host's
 * colours reads as another game feature. Purple platter, green spindle and the
 * wordmark are taken from their favicon and stylesheet.
 *
 * The turntable is inlined rather than linked, so the banner costs no request
 * and cannot break when their asset paths change.
 */

import './ZapclubBanner.css'

function Turntable() {
  return (
    <svg className="zc-logo" viewBox="0 0 36 36" role="img" aria-label="zapclub turntable">
      <g className="zc-platter">
        <circle cx="16" cy="20" r="13" fill="#1b0b33" stroke="#8e30eb" strokeWidth="1.6" />
        <circle cx="16" cy="20" r="9.5" fill="none" stroke="#a855f7" strokeWidth="0.5" opacity="0.4" />
        <circle cx="16" cy="20" r="6.5" fill="none" stroke="#a855f7" strokeWidth="0.5" opacity="0.3" />
        <circle cx="16" cy="20" r="3.6" fill="#22c55e" />
        <circle cx="16" cy="11.5" r="1.1" fill="#d8b4fe" />
        <circle cx="16" cy="20" r="1" fill="#1b0b33" />
      </g>
      <line x1="29" y1="7" x2="20.5" y2="15.5" stroke="#c084fc" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="29" cy="7" r="1.9" fill="#c084fc" />
    </svg>
  )
}

export default function ZapclubBanner() {
  return (
    <a
      className="zc-banner"
      href="https://zapclub.io"
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="zc-tag">Partner</span>
      <div className="zc-art">
        <Turntable />
      </div>
      <div className="zc-copy">
        <span className="zc-wordmark">zapclub<span className="zc-dot">.io</span></span>
        <span className="zc-slogan">DJ and listen together while rolling your joints!</span>
        <span className="zc-sub">Open a club that belongs to you — same crew, same beat, real zaps.</span>
        <span className="zc-cta">Open a club →</span>
      </div>
    </a>
  )
}
