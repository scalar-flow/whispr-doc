import { pipeline, env } from '@huggingface/transformers'
import { isMobileDevice } from './utils'

env.allowLocalModels = false

class PipelineFactory {
    static task = null
    static model = null
    static instances = new Map()

    static async getInstance(progress_callback = null) {
        const key = `${this.task}-${this.model}`
        if (!this.instances.has(key)) {
            console.log(`[Worker] Creating new pipeline instance for ${key}`)
            this.instances.set(
                key,
                pipeline(this.task, this.model, {
                    progress_callback,
                    device: 'webgpu' // Attempt WebGPU if available
                }).catch(async (err) => {
                    console.warn(`[Worker] WebGPU failed, falling back to CPU:`, err)
                    return pipeline(this.task, this.model, { progress_callback })
                })
            )
        }

        return this.instances.get(key)
    }
}

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
    static task = 'automatic-speech-recognition'
    static model = null // Model will be set dynamically
}

self.addEventListener('message', async event => {
    const message = event.data

    if (message.audio) {
        console.log('[Worker] Received audio data for transcription', message.model)
        let transcript = await transcribe(message.audio, message.model)
        if (transcript === null) return

        console.log('[Worker] Transcription complete:', transcript)
        self.postMessage({
            status: 'complete',
            task: 'automatic-speech-recognition',
            data: transcript
        })
    }
})

const transcribe = async (audio, model) => {
    console.log('[Worker] Starting transcription with model:', model)
    const p = AutomaticSpeechRecognitionPipelineFactory

    // Override the model for the factory
    p.model = model || (isMobileDevice() ? 'Xenova/whisper-tiny.en' : 'Xenova/whisper-small.en')

    try {
        const transcriber = await p.getInstance(data => {
            // Forward progress messages to the main thread
            self.postMessage(data)
        })

        const options = {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false, // Set to true if you need timestamps later
        }

        const output = await transcriber(audio, options)
        return output
    } catch (error) {
        console.error('[Worker] Transcription error:', error)
        self.postMessage({
            status: 'error',
            task: 'automatic-speech-recognition',
            data: error.message || error
        })
        return null
    }
}