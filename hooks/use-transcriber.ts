import { useCallback, useMemo, useState } from 'react'
import { useWorker } from '@/hooks/use-worker'
import { Transcriber, TranscriberData, WhisperModel } from '@/lib/types'

export function useTranscriber(): Transcriber {
    const [output, setOutput] = useState<TranscriberData | undefined>()
    const [isProcessing, setIsProcessing] = useState(false)
    const [isModelLoading, setIsModelLoading] = useState(false)
    const [modelLoadingProgress, setModelLoadingProgress] = useState(0)

    const webWorker = useWorker(event => {
        const message = event.data
        console.log('[useTranscriber] Worker message:', message)

        switch (message.status) {
            case 'progress':
                setModelLoadingProgress(message.progress)
                break
            case 'update':
                // Optional: handle partial results
                break
            case 'complete':
                console.log('[useTranscriber] Transcription complete:', message.data)
                setOutput(message.data)
                setIsProcessing(false)
                break
            case 'initiate':
                setIsModelLoading(true)
                break
            case 'ready':
                setIsModelLoading(false)
                break
            case 'error':
                console.error('[useTranscriber] Worker error:', message.data)
                setIsProcessing(false)
                break
            case 'done':
                break
            default:
                break
        }
    })

    const onInputChange = useCallback(() => {
        setOutput(undefined)
    }, [])

    const start = useCallback(
        async (audioData: AudioBuffer | undefined, model?: WhisperModel) => {
            if (audioData) {
                setOutput(undefined)
                setIsProcessing(true)

                let audio
                if (audioData.numberOfChannels === 2) {
                    const SCALING_FACTOR = Math.sqrt(2)

                    const left = audioData.getChannelData(0)
                    const right = audioData.getChannelData(1)

                    audio = new Float32Array(left.length)
                    for (let i = 0; i < audioData.length; ++i) {
                        audio[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2
                    }
                } else {
                    // If the audio is not stereo, we can just use the first channel:
                    audio = audioData.getChannelData(0)
                }

                webWorker?.postMessage({ audio, model })
            }
        },
        [webWorker]
    )

    const transcriber = useMemo(() => {
        return {
            onInputChange,
            isProcessing,
            isModelLoading,
            modelLoadingProgress,
            start,
            output
        }
    }, [
        onInputChange,
        isProcessing,
        isModelLoading,
        modelLoadingProgress,
        start,
        output
    ])

    return transcriber
}