import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp'])

function safePart(value) {
  return String(value || 'dataset').replace(/[^a-z0-9._-]+/gi, '_')
}

function basename(path) {
  return String(path || '').split(/[\\/]/).pop()
}

function extname(path) {
  const name = basename(path)
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx).toLowerCase() : ''
}

function stem(path) {
  const name = basename(path)
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(0, idx) : name
}

function parseYolo(text) {
  const boxes = []
  const errors = []

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return

    const parts = trimmed.split(/\s+/)
    if (parts.length < 5) {
      errors.push(`line ${index + 1}: expected class x y w h`)
      return
    }

    const nums = parts.slice(1, 5).map(Number)
    if (nums.some(n => Number.isNaN(n))) {
      errors.push(`line ${index + 1}: invalid number`)
      return
    }

    const [x_center, y_center, width, height] = nums
    boxes.push({
      x_center,
      y_center,
      width,
      height,
      yolo_txt: `0 ${x_center.toFixed(6)} ${y_center.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`,
    })
  })

  return { boxes, errors }
}

async function uploadToCloudinary(fileBuffer, dataset, filename) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  const publicId = `heckmatt/${safePart(dataset)}/${safePart(stem(filename))}`
  const timestamp = Math.floor(Date.now() / 1000).toString()

  const paramsToSign = `format=jpg&overwrite=true&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto
    .createHash('sha256')
    .update(paramsToSign + apiSecret)
    .digest('hex')

  const formData = new FormData()
  formData.append('file', new Blob([fileBuffer]))
  formData.append('public_id', publicId)
  formData.append('timestamp', timestamp)
  formData.append('api_key', apiKey)
  formData.append('signature', signature)
  formData.append('format', 'jpg')
  formData.append('overwrite', 'true')

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Cloudinary upload failed')
  }

  return res.json()
}

export async function POST(request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
  )

  const formData = await request.formData()
  const dataset = String(formData.get('dataset') || '').trim()
  const files = formData.getAll('files')

  if (!dataset) return Response.json({ error: 'Dataset name is required' }, { status: 400 })
  if (!files || files.length === 0) return Response.json({ error: 'No files provided' }, { status: 400 })

  const imageFiles = []
  const labels = new Map()

  for (const file of files) {
    const name = file.name
    const ext = extname(name)
    if (IMAGE_EXTS.has(ext)) imageFiles.push(file)
    if (ext === '.txt') labels.set(stem(name).toLowerCase(), file)
  }

  const results = []

  for (const file of imageFiles) {
    const filename = basename(file.name)
    const label = labels.get(stem(filename).toLowerCase())

    if (!label) {
      results.push({ filename, status: 'skipped', reason: 'Missing YOLO label file' })
      continue
    }

    try {
      const labelText = await label.text()
      const { boxes, errors } = parseYolo(labelText)
      if (errors.length > 0) throw new Error(errors.slice(0, 3).join('; '))
      if (boxes.length === 0) throw new Error('YOLO label has no boxes')

      const { data: existing } = await supabase
        .from('images')
        .select('id')
        .eq('filename', filename)
        .maybeSingle()

      if (existing) {
        results.push({ filename, status: 'skipped', reason: 'Already exists in DB' })
        continue
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const cloudResult = await uploadToCloudinary(buffer, dataset, filename)

      const { data: inserted, error: insertError } = await supabase
        .from('images')
        .insert({
          filename,
          dataset,
          cloudinary_url: cloudResult.secure_url,
          cloudinary_id: cloudResult.public_id,
          heckmatt_grade: null,
          is_annotated: true,
        })
        .select('id')
        .single()

      if (insertError) throw new Error(insertError.message)

      const rows = boxes.map(b => ({
        image_id: inserted.id,
        x_center: b.x_center,
        y_center: b.y_center,
        width: b.width,
        height: b.height,
        heckmatt_grade: null,
        yolo_txt: b.yolo_txt,
      }))

      const { error: annotationError } = await supabase.from('annotations').insert(rows)
      if (annotationError) throw new Error(annotationError.message)

      results.push({ filename, status: 'ok', boxes: boxes.length })
    } catch (err) {
      results.push({ filename, status: 'error', reason: err.message })
    }
  }

  const allOk = results.length > 0 && results.every(r => r.status === 'ok')
  const anyOk = results.some(r => r.status === 'ok')
  const httpStatus = allOk ? 200 : anyOk ? 207 : 500

  return Response.json({ results }, { status: httpStatus })
}
