"use client"

import { useState } from "react"

export function CommentPopover() {
  const [isOpen, setIsOpen] = useState(true)

  if (!isOpen) return null

  return (
    <div className="absolute right-0 top-8 z-10 w-64 rounded-lg border border-border bg-background p-3 shadow-lg">
      <div className="mb-2 flex items-start gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-sm font-medium text-emerald-700">
          M
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Mark Thompson</span>
            <span className="text-xs text-muted-foreground">12m ago</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Should we update this figure based on the latest Q3 closing numbers?
          </p>
        </div>
      </div>
      <div className="flex gap-2 text-sm">
        <button className="font-medium text-primary hover:underline">Reply</button>
        <button
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          Resolve
        </button>
      </div>
    </div>
  )
}
