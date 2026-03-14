"use client"

import "@/lib/polyfill"
import { useCallback, useState, useRef, useEffect } from "react"
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
  RefreshCw,
  LocateFixed,
  FileText,
  FileSpreadsheet,
  FileType,
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
import { siGoogledrive, siIcloud, siDropbox, siBox } from "simple-icons"
import Uppy from "@uppy/core"
import Dashboard from "@uppy/dashboard"
import GoogleDrive from "@uppy/google-drive"
import Dropbox from "@uppy/dropbox"
import OneDrive from "@uppy/onedrive"
import Box from "@uppy/box"

// Updated Uppy v4 CSS paths
import "@uppy/core/css/style.css"
import "@uppy/dashboard/css/style.css"

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
  onReset: () => void
  onFileSelect: (file: File | null) => void
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
  onReset,
  onFileSelect,
}: DocumentViewerProps) {
  const [isLocalDragging, setIsLocalDragging] = useState(false)
  const [isGlobalDragging, setIsGlobalDragging] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isWandActive, setIsWandActive] = useState(false)
  const [uppy, setUppy] = useState<Uppy | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const hasPdf = pdfFile !== null

  // 1. Initialize Uppy strictly on the client (fixes SSR document is not defined error)
  useEffect(() => {
    const u = new Uppy({
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: [".pdf", "application/pdf"],
      },
      autoProceed: false,
    })

    // Natively handles the modal popup (inline: false)
    u.use(Dashboard, {
      id: "Dashboard",
      inline: false,
      closeModalOnClickOutside: true,
      proudlyDisplayPoweredByUppy: false,
    })

    // Attach external providers directly to the Vanilla Dashboard plugin with TS bypass
    u.use(GoogleDrive, { target: Dashboard as any, companionUrl: "https://companion.uppy.io" })
    u.use(Dropbox, { target: Dashboard as any, companionUrl: "https://companion.uppy.io" })
    u.use(OneDrive, { target: Dashboard as any, companionUrl: "https://companion.uppy.io" })
    u.use(Box, { target: Dashboard as any, companionUrl: "https://companion.uppy.io" })

    setUppy(u)

    // Clean up Uppy native DOM nodes when unmounting
    return () => {
      u.destroy()
    }
  }, [])

  // Programmatically open the native Uppy Modal
  const openDashboard = useCallback(() => {
    if (!uppy) return
    const dashboard = uppy.getPlugin("Dashboard")
    if (dashboard) {
      // @ts-ignore - Bypass Uppy typing strictness for openModal method
      dashboard.openModal()
    }
  }, [uppy])

  // Handle Uppy File Completions
  useEffect(() => {
    if (!uppy) return

    const handleComplete = (result: any) => {
      // Safely verify result.successful exists to satisfy TypeScript
      if (result.successful && result.successful.length > 0) {
        const uppyFile = result.successful[0]
        if (uppyFile.data instanceof Blob || uppyFile.data instanceof File) {
          const file = new File([uppyFile.data], uppyFile.name, { type: uppyFile.type })
          onFileSelect(file)
          setPdfUrl(URL.createObjectURL(file))

          // Auto-close native modal on success
          const dashboard = uppy.getPlugin("Dashboard")
          if (dashboard) {
            // @ts-ignore
            dashboard.closeModal()
          }
        }
      }
    }

    uppy.on("complete", handleComplete)

    return () => {
      uppy.off("complete", handleComplete)
    }
  }, [uppy, onFileSelect])

  // Global Drag & Drop functionality
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current += 1
      if (e.dataTransfer?.types.includes("Files")) {
        setIsGlobalDragging(true)
      }
    }
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current -= 1
      if (dragCounter.current === 0) {
        setIsGlobalDragging(false)
      }
    }
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsGlobalDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0 && files[0].type === "application/pdf") {
        const file = files[0]
        onFileSelect(file)
        setPdfUrl(URL.createObjectURL(file))
      }
    }

    window.addEventListener("dragenter", handleDragEnter)
    window.addEventListener("dragleave", handleDragLeave)
    window.addEventListener("dragover", handleDragOver)
    window.addEventListener("drop", handleDrop)

    return () => {
      window.removeEventListener("dragenter", handleDragEnter)
      window.removeEventListener("dragleave", handleDragLeave)
      window.removeEventListener("dragover", handleDragOver)
      window.removeEventListener("drop", handleDrop)
    }
  }, [onFileSelect])

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      onTotalPagesChange(numPages)
    },
    [onTotalPagesChange]
  )

  const handleReset = useCallback(() => {
    setPdfUrl(null)
    onFileSelect(null)
    onReset()
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    uppy?.cancelAll()
  }, [onFileSelect, uppy, onReset])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0 && files[0].type === "application/pdf") {
        const file = files[0]
        onFileSelect(file)
        setPdfUrl(URL.createObjectURL(file))
      }
    }, [onFileSelect]
  )

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden relative">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center overflow-x-auto border-b border-border bg-background px-2">
        {/* Print Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={!hasPdf}
              className="flex h-8 items-center gap-1 rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Printer className="h-4 w-4" />
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem>Download AcroForm</DropdownMenuItem>
            <DropdownMenuItem>Download PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Refresh / Reset Button */}
        <button
          onClick={handleReset}
          disabled={!hasPdf}
          title="Reset Viewer"
          className="ml-1 flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <RefreshCw className="h-4 w-4" />
        </button>

        {/* Separators and PDF tools only show if PDF is loaded */}
        {hasPdf && (
          <>
            <div className="mx-2 h-5 w-px bg-border" />

            {/* Interaction Modes */}
            <button className="flex h-8 w-8 items-center justify-center rounded p-2 text-foreground hover:bg-muted">
              <MousePointer2 className="h-4 w-4" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Hand className="h-4 w-4" />
            </button>

            {/* Wand with dropdown */}
            <Popover open={isWandActive} onOpenChange={setIsWandActive}>
              <PopoverTrigger asChild>
                <button
                  onClick={() => setIsWandActive(!isWandActive)}
                  className={`flex h-8 w-8 items-center justify-center rounded p-2 transition-colors ${isWandActive
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                        <LocateFixed className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="center" sideOffset={4} className="w-48 p-2 mt-1"></PopoverContent>
                  </Popover>

                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Mic className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="center" sideOffset={4} className="w-48 p-2 mt-1"></PopoverContent>
                  </Popover>
                </div>
              </PopoverContent>
            </Popover>

            <div className="mx-2 h-5 w-px bg-border" />

            {/* Pagination */}
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
          </>
        )}

        <div className="flex-1" />

        {/* Search */}
        {hasPdf && (
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search document..."
              className="h-7 w-44 rounded-full bg-zinc-100 pl-8 pr-3 text-xs text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
            />
          </div>
        )}

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
      <div className="relative flex-1 overflow-auto bg-white md:bg-zinc-50">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {!hasPdf ? (
          <div className={`flex h-full w-full items-center justify-center transition-all ${isGlobalDragging ? "p-8" : "p-4"}`}>
            {/* Custom Upload UI */}
            <div className={`flex flex-col w-full transition-all ${isGlobalDragging ? "h-full" : "max-w-3xl"}`}>
              {!isGlobalDragging && (
                <h1 className="text-xl font-semibold text-slate-800 mb-6">Upload File</h1>
              )}

              <div className={`grid transition-all ${isGlobalDragging ? "grid-cols-1 h-full" : "grid-cols-1 md:grid-cols-2 gap-8 md:gap-12"}`}>
                {/* File Uploader via Local Native Drag/Drop */}
                <div className={`flex flex-col transition-all ${isGlobalDragging ? "h-full" : ""}`}>
                  {!isGlobalDragging && (
                    <h2 className="text-sm font-semibold text-slate-700 mb-3">File Uploader</h2>
                  )}
                  <div
                    onClick={handleClick}
                    onDragEnter={() => setIsLocalDragging(true)}
                    onDragLeave={() => setIsLocalDragging(false)}
                    className={`relative flex flex-col items-center justify-center border-dashed rounded-xl cursor-pointer transition-all duration-300 ${isLocalDragging || isGlobalDragging
                      ? "border-blue-500 bg-blue-50/80 shadow-inner"
                      : "border-slate-300 bg-slate-50 hover:border-slate-400"
                      } ${isGlobalDragging
                        ? "h-full border-4 rounded-[3rem] bg-blue-50/95"
                        : "h-64 border-2"
                      }`}
                  >
                    <div className="text-center flex flex-col items-center">
                      {isGlobalDragging ? (
                        <>
                          <div className="relative h-10 w-10 animate-bounce text-blue-600">
                            <FileText className="h-10 w-10 absolute top-0 left-[-20px] z-10 rotate-[-8deg]" fill='#FFF' />
                            <FileSpreadsheet className="h-10 w-10 absolute top-[-12px] left-1/2 transform -translate-x-1/2 z-0" fill='#FFF' />
                            <FileType className="h-10 w-10 absolute top-[2px] right-[-20px] z-10 rotate-[8deg]" fill='#FFF' />
                          </div>
                          <h2 className="text-2xl font-bold text-blue-600">Drop Files here / Upload files</h2>
                          <p className="mt-4 text-lg text-blue-500/70">Release to upload your PDF instantly</p>
                        </>
                      ) : (
                        <>
                          <p className="text-slate-800 font-medium mb-2">Drop files here</p>
                          <p className="text-slate-400 text-sm mb-4">Or</p>
                          <button className="px-6 py-2 rounded-full border border-blue-400 text-blue-500 font-medium hover:bg-blue-50 transition-colors">
                            Upload file
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cloud Providers calling Native Dashboard popup */}
                {!isGlobalDragging && (
                  <div className="flex flex-col">
                    <h2 className="text-sm font-semibold text-slate-700 mb-3">Import files from:</h2>
                    <div className="grid grid-cols-2 gap-4 h-64">
                      <button onClick={openDashboard} className="flex flex-col items-center justify-center p-4 gap-2 border border-slate-200 rounded-xl hover:shadow-md transition-shadow bg-white">
                        <svg viewBox="0 0 24 24" width="35" height="35">
                          <path d={siGoogledrive.path} fill={`#${siGoogledrive.hex}`} />
                        </svg>
                        <span className="text-sm font-medium text-slate-700">Google Drive</span>
                      </button>

                      <button onClick={openDashboard} className="flex flex-col items-center justify-center p-4 gap-2 border border-slate-200 rounded-xl hover:shadow-md transition-shadow bg-white">
                        <svg viewBox="0 0 24 24" width="35" height="35">
                          <path d={siDropbox.path} fill={`#${siDropbox.hex}`} />
                        </svg>
                        <span className="text-sm font-medium text-slate-700">Dropbox</span>
                      </button>

                      <button onClick={openDashboard} className="flex flex-col items-center justify-center p-4 gap-2 border border-slate-200 rounded-xl hover:shadow-md transition-shadow bg-white">
                        <svg viewBox="0 0 24 24" width="35" height="35">
                          <path d={siIcloud.path} fill={`#${siIcloud.hex}`} />
                        </svg>
                        <span className="text-sm font-medium text-slate-700">One Drive</span>
                      </button>

                      <button onClick={openDashboard} className="flex flex-col items-center justify-center p-4 gap-2 border border-slate-200 rounded-xl hover:shadow-md transition-shadow bg-white">
                        <svg viewBox="0 0 24 24" width="35" height="35">
                          <path d={siBox.path} fill={`#${siBox.hex}`} />
                        </svg>
                        <span className="text-sm font-medium text-slate-700">Box</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-full w-full justify-center px-12 py-8 bg-zinc-200">
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={
                <div className="flex h-96 w-full items-center justify-center">
                  <div className="text-muted-foreground animate-pulse">Loading PDF...</div>
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