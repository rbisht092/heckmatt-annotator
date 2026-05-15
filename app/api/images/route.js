import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
    global: {
      fetch: (url, options = {}) =>
        fetch(url, { ...options, cache: 'no-store' }),  // ← new
    },
  }
  )

  const { searchParams } = new URL(request.url)
  const annotated = searchParams.get('annotated') === 'true'
  const dataset   = searchParams.get('dataset')
  const skipIds   = searchParams.get('skip')?.split(',').filter(Boolean) || []

  if (annotated) {
    let query = supabase
      .from('annotations')
      .select('id, x_center, y_center, width, height, heckmatt_grade, created_at, images!inner(id, filename, dataset, cloudinary_url, heckmatt_grade)')
      .order('created_at', { ascending: false })

    if (dataset) {
      query = query.eq('images.dataset', dataset)
    }

    const { data, error } = await query

    if (error) return Response.json({ error: error.message }, { status: 500 })

    const byImage = new Map()
    for (const row of data || []) {
      const img = row.images
      if (!img) continue

      if (!byImage.has(img.id)) {
        byImage.set(img.id, {
          id:       img.id,
          filename: img.filename,
          dataset:  img.dataset,
          grade:    img.heckmatt_grade ?? row.heckmatt_grade,
          url:      img.cloudinary_url,
          boxes:    [],
        })
      }

      byImage.get(img.id).boxes.push({
        x_center: row.x_center,
        y_center: row.y_center,
        width:    row.width,
        height:   row.height,
      })
    }

    const images = Array.from(byImage.values())

    return Response.json({ images })
  }

  let query = supabase
    .from('images')
    .select('id, filename, cloudinary_url, heckmatt_grade, is_annotated')
    .eq('is_annotated', false)
    .order('created_at', { ascending: true })
    .limit(1)

  if (skipIds.length > 0) {
    query = query.not('id', 'in', `(${skipIds.join(',')})`)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return Response.json({ done: true })

  const image = data[0]
  return Response.json({
    id:       image.id,
    filename: image.filename,
    grade:    image.heckmatt_grade ?? null,   // null for unlabeled images
    url:      image.cloudinary_url,
  })
}
