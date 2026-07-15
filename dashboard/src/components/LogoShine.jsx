// A logo image with the Elsewedy-style sheen: a highlight that loops across the
// logo, masked to the logo's own silhouette (see `.logo-shine` in index.css).
// Used on the splash, the login card, and the dashboard header so the effect is
// identical everywhere.
//
// Props:
//   src        - image path (also used as the sheen mask)
//   alt        - alt text
//   shine      - 'light' (white glint, for dark logos on light backgrounds) or
//                'dark'  (soft dark sheen, for the white logo on the splash)
//   className / imgClassName - extra classes for the wrapper / the <img>
//   fallback   - optional node rendered (hidden) after the logo; shown if the
//                image fails to load.
export default function LogoShine({
  src,
  alt,
  shine = 'light',
  className = '',
  imgClassName = '',
  fallback = null,
}) {
  return (
    <>
      <span
        className={`logo-shine logo-shine-${shine} ${className}`.trim()}
        style={{ '--logo-src': `url(${src})` }}
      >
        <img
          className={imgClassName}
          src={src}
          alt={alt}
          onError={(e) => {
            // Hide the whole sheen wrapper and reveal the fallback sibling.
            const wrap = e.currentTarget.parentElement
            wrap.style.display = 'none'
            if (wrap.nextElementSibling) {
              wrap.nextElementSibling.style.display = 'block'
            }
          }}
        />
      </span>
      {fallback}
    </>
  )
}
