export function TopAppBar({ title }: { title?: string }) {
  return (
    <div className="h-16 bg-surface border-b border-outline-variant flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center">
        {title && <h2 className="text-lg font-semibold text-on-surface">{title}</h2>}
      </div>
    </div>
  )
}
