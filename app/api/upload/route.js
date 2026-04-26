import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// Cloudinary signed upload using REST API (no SDK needed)
async function uploadToCloudinary(fileBuffer, filename) {
  const cloudName  = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey     = process.env.CLOUDINARY_API_KEY
  const apiSecret  = process.env.CLOUDINARY_API_SECRET

  const publicId   = `heckmatt/unlabeled/${filename.rsplit ? filename.rsplit('.', 1)[0] : filename.replace(/\.[^/.]+$/, '').replace(/\./g, '_')}`
  const timestamp  = Math.floor(Date.now() / 1000).toString()

  // Generate signature: sign sorted param string with API secret
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
  const files    = formData.getAll('files')  // supports multiple files

  if (!files || files.length === 0) {
    return Response.json({ error: 'No files provided' }, { status: 400 })
  }

  const results = []

  for (const file of files) {
    const filename = file.name
    const buffer   = Buffer.from(await file.arrayBuffer())

    try {
      // 1. Upload to Cloudinary
      const cloudResult = await uploadToCloudinary(buffer, filename)

      // 2. Check for duplicate filename in Supabase
      const { data: existing } = await supabase
        .from('images')
        .select('id')
        .eq('filename', filename)
        .maybeSingle()

      if (existing) {
        results.push({ filename, status: 'skipped', reason: 'Already exists in DB' })
        continue
      }

      // 3. Insert into Supabase with no grade (unlabeled)
      const { error: insertError } = await supabase.from('images').insert({
        filename:       filename,
        cloudinary_url: cloudResult.secure_url,
        cloudinary_id:  cloudResult.public_id,
        is_annotated:   false,
        // heckmatt_grade intentionally omitted — will be assigned in the annotator
      })

      if (insertError) throw new Error(insertError.message)

      results.push({ filename, status: 'ok', url: cloudResult.secure_url })

    } catch (err) {
      results.push({ filename, status: 'error', reason: err.message })
    }
  }

  const allOk     = results.every(r => r.status === 'ok')
  const anyOk     = results.some(r => r.status === 'ok')
  const httpStatus = allOk ? 200 : anyOk ? 207 : 500  // 207 = partial success

  return Response.json({ results }, { status: httpStatus })
}
