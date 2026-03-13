"use client"

export function AppHeader() {
  return (
    <header className="flex h-14 items-center border-b border-border bg-background px-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-10 items-center justify-center rounded-lg bg-primary">
          <span className="text-sm font-bold text-primary-foreground italic">W/</span>
        </div>
        <span className="text-base font-semibold text-foreground">WhisprDoc Pro</span>
      </div>
    </header>
  )
}
