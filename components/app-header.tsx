"use client"

export function AppHeader() {
  return (
    <header className="flex h-14 items-center border-b border-border bg-background px-4">
      <div className="flex items-center gap-2.5">
        <img src="/logo.png" alt="Logo" className="h-[38px] w-[38px]" />
        <span className="text-lg font-semibold text-foreground">WhisprDoc Pro</span>
      </div>
    </header>
  )
}
