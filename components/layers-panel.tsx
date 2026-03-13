"use client"

import { ChevronDown, ChevronRight, FileText, Type, Image, AlignLeft, Square, Filter, Layers } from "lucide-react"

interface LayersPanelProps {
  currentPage: number
  onPageChange: (page: number) => void
  totalPages: number
  hasPdf: boolean
}

const pageElements: Record<number, { icon: React.ElementType; name: string }[]> = {
  1: [
    { icon: Type, name: "Header_Title" },
    { icon: Image, name: "Company_Logo" },
    { icon: AlignLeft, name: "Intro_Paragraph" },
    { icon: Square, name: "Chart_Container" },
  ],
  2: [],
  3: [],
}

export function LayersPanel({ currentPage, onPageChange, totalPages, hasPdf }: LayersPanelProps) {
  const pages = Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1)

  return (
    <aside className="flex w-60 flex-col border-r border-border bg-background">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Layers / Fields
        </span>
        <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
          <Filter className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {!hasPdf ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-3 rounded-full bg-zinc-100 p-3">
              <Layers className="h-6 w-6 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-foreground">No fields found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Upload a PDF to view its layers and fields
            </p>
          </div>
        ) : (
          pages.map((page) => {
            const isSelected = page === currentPage
            const elements = pageElements[page] || []

            return (
              <div key={page}>
                <button
                  onClick={() => onPageChange(page)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? "bg-sidebar-accent text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  {isSelected ? (
                    <ChevronDown className="h-4 w-4 text-primary" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <FileText className={`h-4 w-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={isSelected ? "font-medium" : ""}>
                    Page {page}
                  </span>
                </button>
                {isSelected && elements.length > 0 && (
                  <div className="ml-6">
                    {elements.map((element, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 py-1.5 pl-4 pr-3 text-sm text-foreground hover:bg-muted"
                      >
                        <element.icon className="h-4 w-4 text-muted-foreground" />
                        <span>{element.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
