// Full-area loading state: a centered spinner shown while a page fetches data.
export default function PageLoader() {
  return (
    <div className="page-loader">
      <span className="page-spinner" aria-label="Loading" />
    </div>
  )
}
