// Small inline loading spinner for buttons/actions. Pass `light` for a white
// spinner (on red/dark buttons).
export default function Spinner({ light = false }) {
  return <span className={`spinner${light ? ' spinner-light' : ''}`} aria-hidden="true" />
}
