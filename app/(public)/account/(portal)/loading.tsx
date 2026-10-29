export default function AccountLoading() {
  return (
    <div className="account-page-body" aria-busy="true" role="status" data-workspace-loading>
      <div className="public-manage-card content-skeleton">
        <p className="workspace-loading-label">Loading the page…</p>
        <div aria-hidden="true" className="content-skeleton-bar content-skeleton-title" />
        <div aria-hidden="true" className="content-skeleton-bar content-skeleton-line" />
        <div aria-hidden="true" className="content-skeleton-bar content-skeleton-panel" />
      </div>
    </div>
  );
}
