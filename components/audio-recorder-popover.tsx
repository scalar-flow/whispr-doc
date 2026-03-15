// audio-recorder-popover.tsx
"use client"

import { useState, useRef, useEffect } from "react"
import { Mic, X, Check, Loader2, AlertCircle, Ellipsis } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { AudioVisualizer } from "./audio-visualizer"
import { cn } from "@/lib/utils"
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition'
import { useTranscriber } from '@/hooks/use-transcriber'

interface AudioRecorderProps {
    onTranscript?: (text: string) => void;
    mode?: "web-speech" | "whisper";
}

export function AudioRecorder({ onTranscript, mode = "web-speech" }: AudioRecorderProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [transcriptionMode, setTranscriptionMode] = useState<"web-speech" | "whisper-tiny" | "whisper-small">(mode as any)

    // Unified stream state for both modes (for the visualizer)
    const [visualizerStream, setVisualizerStream] = useState<MediaStream | null>(null)

    // Whisper-specific local recording state
    const [isRecordingWhisper, setIsRecordingWhisper] = useState(false)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])

    const transcriber = useTranscriber()

    const {
        transcript: webSpeechTranscript,
        resetTranscript: resetWebSpeech,
        listening: isRecordingWebSpeech
    } = useSpeechRecognition()

    const isRecording = transcriptionMode === "web-speech" ? isRecordingWebSpeech : isRecordingWhisper;
    const isProcessing = transcriptionMode === "web-speech" ? false : (transcriber.isProcessing || transcriber.isModelLoading);

    const shouldProcessOutput = useRef(false)

    useEffect(() => {
        if (transcriber.output && shouldProcessOutput.current) {
            const whisperText = typeof transcriber.output === 'string'
                ? transcriber.output
                : (transcriber.output as any).text || JSON.stringify(transcriber.output);

            // Log the model name and audio output
            console.log(`Model: ${transcriptionMode}`, whisperText);

            // Return strictly the Whisper output
            if (onTranscript) onTranscript(whisperText)

            shouldProcessOutput.current = false
            setIsOpen(false)
        }
    }, [transcriber.output, onTranscript, transcriptionMode])

    // Cleanup streams when popover closes
    useEffect(() => {
        if (!isOpen) {
            stopAllStreams()
        }
    }, [isOpen])

    // --- Helpers ---

    const stopAllStreams = () => {
        if (visualizerStream) {
            visualizerStream.getTracks().forEach(track => track.stop())
            setVisualizerStream(null)
        }
        if (isRecordingWebSpeech) {
            SpeechRecognition.stopListening()
        }
        if (isRecordingWhisper) {
            mediaRecorderRef.current?.stop()
            setIsRecordingWhisper(false)
        }
    }

    const startRecordingFn = async (mode = transcriptionMode) => {
        try {
            // 1. Get Microphone Stream
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            setVisualizerStream(stream)

            if (mode === "web-speech") {
                // Strictly record only using Web Speech
                resetWebSpeech()
                SpeechRecognition.startListening({ continuous: true })
            } else {
                // 2. Setup MediaRecorder solely for Whisper
                chunksRef.current = []
                const mediaRecorder = new MediaRecorder(stream)

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data)
                }

                mediaRecorder.start()
                mediaRecorderRef.current = mediaRecorder
                setIsRecordingWhisper(true)
            }
        } catch (err) {
            console.error("Error accessing microphone:", err)
        }
    }

    const handlePopoverOpenChange = (open: boolean) => {
        if (open) {
            setIsOpen(true)
            startRecordingFn()
        } else {
            if (isProcessing) return;
            handleCancel()
        }
    }

    const handleCancel = () => {
        stopAllStreams()
        if (transcriptionMode === "web-speech") {
            resetWebSpeech()
        }
        // No specific reset needed for transcriber as we just won't call start()
        setIsOpen(false)
    }

    const handleConfirm = async () => {
        if (transcriptionMode === "web-speech") {
            stopAllStreams()
            setTimeout(() => {
                // Log the model name and audio output
                console.log(`Model: ${transcriptionMode}`, webSpeechTranscript);

                if (onTranscript) onTranscript(webSpeechTranscript)
                setIsOpen(false)
            }, 750)
        } else {
            // Stop recorder explicitly to flush final data
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop()

                // Wait for the 'stop' event implies data is available, 
                // but simpler to do this via a Promise wrapper or manual processing
                // Since we need to wait for the last "dataavailable", we wrap the processing:

                mediaRecorderRef.current.onstop = async () => {
                    setIsRecordingWhisper(false)
                    stopAllStreams() // Clean up visualizer/mic

                    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })

                    try {
                        const arrayBuffer = await blob.arrayBuffer()
                        const audioContext = new AudioContext({ sampleRate: 16000 })
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

                        shouldProcessOutput.current = true;
                        const model = transcriptionMode === "whisper-tiny" ? "Xenova/whisper-tiny.en" : "Xenova/whisper-small.en";
                        transcriber.start(audioBuffer, model as any)
                    } catch (e) {
                        console.error("Error decoding audio data", e)
                    }
                }
            }
        }
    }

    const loadingMessage = transcriber.isModelLoading
        ? `Loading Model... ${Math.round(transcriber.modelLoadingProgress || 0)}%`
        : "Transcribing...";

    return (
        <Popover open={isOpen} onOpenChange={handlePopoverOpenChange}>
            <PopoverTrigger asChild>
                <button className={cn("flex h-8 w-8 items-center justify-center rounded hover:bg-muted", isOpen ? "bg-blue-50 text-blue-500" : "text-muted-foreground hover:text-foreground")}>
                    <Mic className="h-4 w-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                side="bottom"
                align="center"
                className="w-auto p-0 border-none bg-transparent shadow-none focus:outline-none mb-2"
            >
                {/* Pill Shape Container */}
                <div className="flex items-center gap-2 h-14 pl-4 pr-2 bg-white rounded-full border border-border shadow-xl w-[320px]">

                    {/* Visualizer Area */}
                    <div className="flex-1 overflow-hidden h-full flex items-center justify-center relative">
                        {visualizerStream && isRecording && !isProcessing && (
                            <div className="w-full h-[30px] flex items-center justify-center overflow-hidden scale-x-[-1]">
                                <AudioVisualizer
                                    stream={visualizerStream}
                                    width={220}
                                    height={30}
                                    barColor="#000000"
                                    gap={2}
                                />
                            </div>
                        )}

                        {isProcessing && (
                            <div className="absolute inset-x-0 inset-y-0 bg-white/80 flex items-center justify-center rounded-full z-10 gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <span className="text-xs font-medium">
                                    {loadingMessage}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 pl-2 border-l border-gray-100 shrink-0">
                        <DropdownMenu modal={false} >
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-full hover:bg-gray-100 hover:text-gray-600"
                                    disabled={isProcessing}
                                >
                                    <Ellipsis className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[280px] p-2">
                                <DropdownMenuItem
                                    onClick={() => {
                                        stopAllStreams();
                                        if (transcriptionMode === "web-speech") resetWebSpeech();
                                        setTranscriptionMode("web-speech");
                                        startRecordingFn("web-speech");
                                    }}
                                    className="flex items-center justify-between py-3 cursor-pointer"
                                >
                                    <div className="flex flex-col text-left">
                                        <span className="font-semibold text-sm">Web Speech API</span>
                                        <span className="text-xs text-muted-foreground mt-0.5">Instant</span>
                                    </div>
                                    {transcriptionMode === "web-speech" && <Check className="h-4 w-4 text-primary" />}
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                    onClick={() => {
                                        stopAllStreams();
                                        setTranscriptionMode("whisper-tiny");
                                        startRecordingFn("whisper-tiny");
                                    }}
                                    className="flex items-center justify-between py-3 cursor-pointer"
                                >
                                    <div className="flex flex-col text-left gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm">Whisper tiny</span>
                                        </div>
                                        <div className="flex items-center  gap-2">
                                            <span className="text-xs text-muted-foreground">Fast</span>
                                            <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border-none text-[10px] px-1.5 h-4 font-bold">
                                                Recommended
                                            </Badge>
                                        </div>
                                    </div>
                                    {transcriptionMode === "whisper-tiny" && <Check className="h-4 w-4 text-primary" />}
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                    onClick={() => {
                                        stopAllStreams();
                                        setTranscriptionMode("whisper-small");
                                        startRecordingFn("whisper-small");
                                    }}
                                    className="flex items-center justify-between py-3 cursor-pointer"
                                >
                                    <div className="flex flex-col text-left gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm">Whisper small</span>
                                        </div>
                                        <div className="flex items-center  gap-2">
                                            <span className="text-xs text-muted-foreground">Slower</span>
                                            <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none text-[10px] px-1.5 h-4 font-bold">
                                                Most accurate
                                            </Badge>
                                        </div>
                                    </div>
                                    {transcriptionMode === "whisper-small" && <Check className="h-4 w-4 text-primary" />}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full hover:bg-red-50 hover:text-red-600"
                            onClick={handleCancel}
                            disabled={isProcessing}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full hover:bg-green-50 hover:text-green-600"
                            onClick={handleConfirm}
                            disabled={isProcessing || !isRecording}
                        >
                            {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Check className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}