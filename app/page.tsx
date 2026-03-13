"use client"

import { useState, useCallback } from "react"
import { AppHeader } from "@/components/app-header"
import { LayersPanel } from "@/components/layers-panel"
import { DocumentViewer } from "@/components/document-viewer"
import { DocumentAssistant } from "@/components/document-assistant"

export default function WhisprDocPro() {
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [isAssistantOpen, setIsAssistantOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [pdfFile, setPdfFile] = useState<File | null>(null)

  const hasPdf = pdfFile !== null

  const handleFileSelect = useCallback((file: File) => {
    setPdfFile(file)
    setCurrentPage(1)
    setTotalPages(0)
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background">
      <AppHeader />
      <div className="flex flex-1 overflow-hidden">
        <LayersPanel
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          totalPages={totalPages}
          hasPdf={hasPdf}
        />
        <DocumentViewer
          currentPage={currentPage}
          totalPages={totalPages}
          zoom={zoom}
          onZoomChange={setZoom}
          onPageChange={setCurrentPage}
          onTotalPagesChange={setTotalPages}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isAssistantOpen={isAssistantOpen}
          onToggleAssistant={() => setIsAssistantOpen(!isAssistantOpen)}
          pdfFile={pdfFile}
          onFileSelect={handleFileSelect}
        />
        {isAssistantOpen && (
          <DocumentAssistant onClose={() => setIsAssistantOpen(false)} hasPdf={hasPdf} />
        )}
      </div>
    </div>
  )
}
