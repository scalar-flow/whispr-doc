"use client"

import "@/lib/polyfill"
import { useCallback, useState, useRef } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/esm/Page/AnnotationLayer.css"
import "react-pdf/dist/esm/Page/TextLayer.css"
import {
  Printer,
  MousePointer2,
  Hand,
  Wand,
  Mic,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Search,
  MessageSquare,
  ChevronDown,
  Upload,
  FileText,
  LocateFixed,
} from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface DocumentViewerProps {
  currentPage: number
  totalPages: number
  zoom: number
  onZoomChange: (zoom: number) => void
  onPageChange: (page: number) => void
  onTotalPagesChange: (total: number) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  isAssistantOpen: boolean
  onToggleAssistant: () => void
  pdfFile: File | null
  onFileSelect: (file: File) => void
}

export function DocumentViewer({
  currentPage,
  totalPages,
  zoom,
  onZoomChange,
  onPageChange,
  onTotalPagesChange,
  searchQuery,
  onSearchChange,
  isAssistantOpen,
  onToggleAssistant,
  pdfFile,
  onFileSelect,
}: DocumentViewerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isWandActive, setIsWandActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasPdf = pdfFile !== null

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      onTotalPagesChange(numPages)
    },
    [onTotalPagesChange]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0 && files[0].type === "application/pdf") {
      const file = files[0]
      onFileSelect(file)
      const url = URL.createObjectURL(file)
      setPdfUrl(url)
    }
  }, [onFileSelect])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0 && files[0].type === "application/pdf") {
      const file = files[0]
      onFileSelect(file)
      const url = URL.createObjectURL(file)
      setPdfUrl(url)
    }
  }, [onFileSelect])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center overflow-x-auto border-b border-border bg-background px-2">
        {/* Print Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 items-center gap-1 rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Printer className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>Download AcroForm</DropdownMenuItem>
            <DropdownMenuItem>Download PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mx-2 h-5 w-px bg-border" />

        {/* Interaction Modes */}
        <button className="flex h-8 w-8 items-center justify-center rounded p-2 text-foreground hover:bg-muted">
          <MousePointer2 className="h-4 w-4" />
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Hand className="h-4 w-4" />
        </button>

        {/* Wand with dropdown */}
        <Popover open={isWandActive && hasPdf} onOpenChange={(open) => hasPdf && setIsWandActive(open)}>
          <PopoverTrigger asChild>
            <button
              disabled={!hasPdf}
              onClick={() => hasPdf && setIsWandActive(!isWandActive)}
              className={`flex h-8 w-8 items-center justify-center rounded p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${isWandActive && hasPdf
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
            >
              <Wand className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            sideOffset={4}
            className="w-auto p-1"
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center gap-1">
              {/* LocateFixed button with popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                    <LocateFixed className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" sideOffset={4} className="w-48 p-2 mt-1">
                </PopoverContent>
              </Popover>

              {/* Mic button with popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Mic className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="center" sideOffset={4} className="w-48 p-2 mt-1">
                </PopoverContent>
              </Popover>
            </div>
          </PopoverContent>
        </Popover>

        <div className="mx-2 h-5 w-px bg-border" />

        {/* Pagination - only show when PDF is loaded */}
        {hasPdf && (
          <>
            <div className="flex items-center">
              <button
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1 px-1 text-sm">
                <input
                  type="text"
                  value={currentPage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val >= 1 && val <= totalPages) {
                      onPageChange(val)
                    }
                  }}
                  className="w-6 rounded border border-border bg-background px-1 py-0.5 text-center text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="text-muted-foreground">/</span>
                <span className="text-muted-foreground">{totalPages}</span>
              </div>
              <button
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mx-2 h-5 w-px bg-border" />
          </>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center">
          <button
            onClick={() => onZoomChange(Math.max(25, zoom - 25))}
            className="flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-8 items-center gap-1 rounded px-2 text-sm text-foreground hover:bg-muted">
                {zoom}%
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem onClick={() => onZoomChange(50)}>50%</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onZoomChange(75)}>75%</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onZoomChange(100)}>100%</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onZoomChange(125)}>125%</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onZoomChange(150)}>150%</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onZoomChange(200)}>200%</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={() => onZoomChange(Math.min(200, zoom + 25))}
            className="flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1" />

        {/* Search - disabled when no PDF */}
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search document..."
            disabled={!hasPdf}
            className="h-7 w-44 rounded-full bg-zinc-100 pl-8 pr-3 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Assistant Toggle */}
        {!isAssistantOpen && (
          <button
            onClick={onToggleAssistant}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Document Area */}
      <div
        className="relative flex-1 overflow-auto bg-zinc-200"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {!hasPdf ? (
          <div className="flex h-full w-full items-center justify-center p-8">
            <div
              onClick={handleClick}
              className={`flex h-full w-full max-w-2xl cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${isDragging
                ? "border-primary bg-primary/5"
                : "border-zinc-300 bg-white hover:border-zinc-400 hover:bg-zinc-50"
                }`}
            >
              <div className={`mb-4 rounded-full p-4 ${isDragging ? "bg-primary/10" : "bg-zinc-100"}`}>
                {isDragging ? (
                  <Upload className="h-10 w-10 text-primary" />
                ) : (
                  <FileText className="h-10 w-10 text-zinc-400" />
                )}
              </div>
              <h3 className="mb-2 text-lg font-medium text-foreground">
                {isDragging ? "Drop your PDF here" : "Upload a PDF document"}
              </h3>
              <p className="mb-4 text-sm text-muted-foreground">
                Drag and drop a PDF file here, or click to browse
              </p>
              <div className="rounded-lg bg-zinc-100 px-4 py-2 text-sm text-muted-foreground">
                Supported format: PDF
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-full w-full justify-center px-12 py-8">
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex h-96 w-full items-center justify-center">
                  <div className="text-muted-foreground">Loading PDF...</div>
                </div>
              }
            >
              <Page
                pageNumber={currentPage}
                scale={zoom / 100}
                className="shadow-xl"
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>
        )}
      </div>
    </div>
  )
}
