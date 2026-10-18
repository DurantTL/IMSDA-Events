/**
 * The staff workspace's loading state (#1003). A `loading.tsx` puts a Suspense
 * boundary around the page inside the layout, so the sidebar and header (the
 * layout) stay on screen while a heavy page streams in, and only the content
 * area shows this skeleton. It is server-rendered and takes no props.
 */
export default function WorkspaceLoading() {
  return (
    <div aria-busy="true" className="content-skeleton" role="status">
      <span className="sr-only">Loading the page…</span>
      <div aria-hidden="true" className="content-skeleton-bar content-skeleton-title" />
      <div aria-hidden="true" className="content-skeleton-bar content-skeleton-line" />
      <div aria-hidden="true" className="content-skeleton-grid">
        <div className="content-skeleton-bar content-skeleton-card" />
        <div className="content-skeleton-bar content-skeleton-card" />
        <div className="content-skeleton-bar content-skeleton-card" />
      </div>
      <div aria-hidden="true" className="content-skeleton-bar content-skeleton-panel" />
    </div>
  );
}
