import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request) {
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

  const body = await request.json()
  const { image_id, boxes, heckmatt_grade, image_filename, is_revisit, grade_was_assigned } = body

  if (is_revisit) {
    const { error: delError } = await supabase
      .from('annotations')
      .delete()
      .eq('image_id', image_id)
    if (delError) return Response.json({ error: delError.message }, { status: 500 })
  }

  // If the doctor assigned a grade in-app (was unlabeled), persist it to the images table first
  if (grade_was_assigned) {
    const { error: gradeError } = await supabase
      .from('images')
      .update({ heckmatt_grade })
      .eq('id', image_id)
    if (gradeError) return Response.json({ error: gradeError.message }, { status: 500 })
  }

  const class_id = heckmatt_grade - 1
  const rows = boxes.map(b => ({
    image_id,
    x_center: b.x_center,
    y_center: b.y_center,
    width:    b.width,
    height:   b.height,
    heckmatt_grade,
    yolo_txt: `${class_id} ${b.x_center.toFixed(6)} ${b.y_center.toFixed(6)} ${b.width.toFixed(6)} ${b.height.toFixed(6)}`,
  }))

  const { error: insertError } = await supabase.from('annotations').insert(rows)
  if (insertError) return Response.json({ error: insertError.message }, { status: 500 })

  const { error: updateError } = await supabase
    .from('images')
    .update({ is_annotated: true })
    .eq('id', image_id)
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 })

  return Response.json({ success: true })
}
