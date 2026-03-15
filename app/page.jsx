'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const GRADE_COLORS = { 1:'#22c55e', 2:'#eab308', 3:'#f97316', 4:'#ef4444' }
const GRADE_LABELS = {
  1:'Normal echogenicity',
  2:'Increased echogenicity, bone visible',
  3:'Markedly increased, bone barely visible',
  4:'Dense shadow, bone not visible',
}

// Resize handle size in px (half-width of the square handle)
const HANDLE_R = 6

// Returns which resize handle (if any) the point (px, py) is over on box b.
// Returns one of: 'nw','n','ne','e','se','s','sw','w', or null
function getHandleAtPoint(px, py, b) {
  const mx = b.x + b.w / 2
  const my = b.y + b.h / 2
  const handles = {
    nw: [b.x,        b.y       ],
    n:  [mx,         b.y       ],
    ne: [b.x + b.w,  b.y       ],
    e:  [b.x + b.w,  my        ],
    se: [b.x + b.w,  b.y + b.h ],
    s:  [mx,         b.y + b.h ],
    sw: [b.x,        b.y + b.h ],
    w:  [b.x,        my        ],
  }
  for (const [key, [hx, hy]] of Object.entries(handles)) {
    if (Math.abs(px - hx) <= HANDLE_R + 2 && Math.abs(py - hy) <= HANDLE_R + 2) return key
  }
  return null
}

// Apply a resize drag delta to a box, returns new {x,y,w,h}
function applyResize(box, handle, dx, dy) {
  let { x, y, w, h } = box
  if (handle.includes('n')) { y += dy; h -= dy }
  if (handle.includes('s')) { h += dy }
  if (handle.includes('w')) { x += dx; w -= dx }
  if (handle.includes('e')) { w += dx }
  // Prevent inverting (minimum size 10px)
  if (w < 10) { if (handle.includes('w')) x = box.x + box.w - 10; w = 10 }
  if (h < 10) { if (handle.includes('n')) y = box.y + box.h - 10; h = 10 }
  return { x, y, w, h }
}

// Cursor style for each handle direction
const HANDLE_CURSORS = {
  nw:'nw-resize', n:'n-resize', ne:'ne-resize',
  e:'e-resize', se:'se-resize', s:'s-resize',
  sw:'sw-resize', w:'w-resize',
}

export default function AnnotatorPage() {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)

  const [image, setImage]             = useState(null)
  const [boxes, setBoxes]             = useState([])
  const [draftBox, setDraftBox]       = useState(null)
  const [drawing, setDrawing]         = useState(false)
  const [startPos, setStartPos]       = useState(null)
  const [currentPos, setCurrentPos]   = useState(null)
  const [status, setStatus]           = useState('loading')
  const [skippedIds, setSkippedIds]   = useState([])
  const [imgLoaded, setImgLoaded]     = useState(false)
  const [displaySize, setDisplaySize] = useState({ w:0, h:0 })
  const [isRevisit, setIsRevisit]     = useState(false)

  const [history, setHistory]           = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const [showBrowse, setShowBrowse]       = useState(false)
  const [annotatedList, setAnnotatedList] = useState([])
  const [browseLoading, setBrowseLoading] = useState(false)

  const [authed, setAuthed]         = useState(false)
  const [passInput, setPassInput]   = useState('')
  const [passError, setPassError]   = useState(false)

  // Resize state for the draft box
  const [resizing, setResizing]         = useState(false)
  const [resizeHandle, setResizeHandle] = useState(null)   // 'nw','n','ne', etc.
  const [resizeStart, setResizeStart]   = useState(null)   // {x,y} mouse pos at drag start
  const [resizeBoxOrigin, setResizeBoxOrigin] = useState(null) // box snapshot at drag start
  const [hoverHandle, setHoverHandle]   = useState(null)   // for cursor feedback

  const PASSCODE = 'heckmatt2024'

  const handlePassSubmit = () => {
    if (passInput === PASSCODE) { setAuthed(true); setPassError(false) }
    else { setPassError(true); setPassInput('') }
  }

  const MAX_BOXES = 2

  // ── fetch next unannotated ────────────────────────────────────────────────
  const fetchNext = useCallback(async (skips, hist, hIdx, replaceCurrent = false, excludeId = null) => {
    setStatus('loading'); setBoxes([]); setDraftBox(null); setImgLoaded(false); setIsRevisit(false)
    try {
      const allExcludes = excludeId ? [...skips, excludeId] : skips
      const q = allExcludes.length ? `?skip=${allExcludes.join(',')}` : ''
      const res  = await fetch(`/api/images${q}${q?'&':'?'}t=${Date.now()}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.done) { setStatus('done'); return }
      const nh = replaceCurrent && hIdx >= 0 ? [...hist.slice(0, hIdx), data] : [...hist.slice(0, hIdx + 1), data]
      setHistory(nh); setHistoryIndex(nh.length - 1)
      setImage(data); setStatus('ready')
    } catch { setStatus('error') }
  }, [])

  useEffect(() => { fetchNext([], [], -1) }, [])

  const loadImage = (img, revisit = false) => {
    setBoxes([]); setDraftBox(null); setImgLoaded(false)
    setIsRevisit(revisit); setImage(img); setStatus('ready')
  }

  // ── canvas rendering ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgLoaded) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const color = image ? GRADE_COLORS[image.grade] : '#00d4ff'

    // Draw each finalized box
    boxes.forEach((b, i) => {
      ctx.shadowColor = color; ctx.shadowBlur = 6
      ctx.strokeStyle = color; ctx.lineWidth = 2
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      ctx.shadowBlur = 0
      ctx.fillStyle = color + '15'
      ctx.fillRect(b.x, b.y, b.w, b.h)
      ctx.font = 'bold 12px IBM Plex Mono, monospace'
      ctx.fillStyle = color
      ctx.fillText(`Muscle ${i + 1}`, b.x + 6, b.y + 16)
    })

    // Draw in-progress draw (while dragging a new box)
    const liveDrawing = drawing && startPos && currentPos
      ? { x:Math.min(startPos.x,currentPos.x), y:Math.min(startPos.y,currentPos.y), w:Math.abs(currentPos.x-startPos.x), h:Math.abs(currentPos.y-startPos.y) }
      : null

    // Draft box (drawn, pending confirm / resizable)
    const live = liveDrawing || draftBox

    if (live) {
      ctx.shadowColor = color; ctx.shadowBlur = 14
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5
      ctx.setLineDash([5,4]); ctx.strokeRect(live.x, live.y, live.w, live.h)
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      ctx.fillStyle = color + '20'
      ctx.fillRect(live.x, live.y, live.w, live.h)
      if (live.w > 40 && live.h > 20) {
        ctx.font = '11px IBM Plex Mono, monospace'; ctx.fillStyle = '#fff'
        ctx.fillText(`${Math.round(live.w)}×${Math.round(live.h)}`, live.x+6, live.y-6)
      }

      // Draw resize handles only when it is the confirmed draft (not mid-draw)
      if (!liveDrawing && draftBox) {
        const mx = live.x + live.w / 2
        const my = live.y + live.h / 2
        const handlePoints = {
          nw:[live.x,       live.y      ], n:[mx,        live.y      ], ne:[live.x+live.w,live.y      ],
          e: [live.x+live.w,my          ], se:[live.x+live.w,live.y+live.h],
          s: [mx,           live.y+live.h], sw:[live.x,  live.y+live.h], w:[live.x,my],
        }
        for (const [key, [hx, hy]] of Object.entries(handlePoints)) {
          const isHovered = hoverHandle === key
          // Outer glow ring
          ctx.shadowColor = color; ctx.shadowBlur = isHovered ? 12 : 6
          ctx.strokeStyle = color; ctx.lineWidth = 1.5
          ctx.strokeRect(hx - HANDLE_R, hy - HANDLE_R, HANDLE_R*2, HANDLE_R*2)
          ctx.shadowBlur = 0
          // Inner fill
          ctx.fillStyle = isHovered ? color : '#0a0e14'
          ctx.fillRect(hx - HANDLE_R + 1, hy - HANDLE_R + 1, HANDLE_R*2 - 2, HANDLE_R*2 - 2)
        }
      }
    }
  }, [boxes, draftBox, drawing, startPos, currentPos, imgLoaded, image, hoverHandle])

  const getPos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    return { x: Math.max(0,Math.min(cx-r.left, canvasRef.current.width)), y: Math.max(0,Math.min(cy-r.top, canvasRef.current.height)) }
  }

  const atLimit  = !isRevisit && boxes.length >= MAX_BOXES
  const hasDraft = !!draftBox

  // ── pointer down ─────────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    e.preventDefault()
    const p = getPos(e)

    // Check if clicking on a resize handle of the draft box
    if (draftBox) {
      const handle = getHandleAtPoint(p.x, p.y, draftBox)
      if (handle) {
        setResizing(true)
        setResizeHandle(handle)
        setResizeStart(p)
        setResizeBoxOrigin({ ...draftBox })
        return
      }
    }

    if (atLimit) return
    setDraftBox(null); setDrawing(true)
    setStartPos(p); setCurrentPos(p)
  }

  // ── pointer move ──────────────────────────────────────────────────────────
  const onMouseMove = (e) => {
    e.preventDefault()
    const p = getPos(e)

    // Handle resize drag
    if (resizing && resizeHandle && resizeBoxOrigin && resizeStart) {
      const dx = p.x - resizeStart.x
      const dy = p.y - resizeStart.y
      const newBox = applyResize(resizeBoxOrigin, resizeHandle, dx, dy)
      setDraftBox(newBox)
      return
    }

    // Handle new box drawing
    if (drawing) { setCurrentPos(p); return }

    // Update hover handle cursor
    if (draftBox) {
      const handle = getHandleAtPoint(p.x, p.y, draftBox)
      setHoverHandle(handle)
    }
  }

  // ── pointer up ────────────────────────────────────────────────────────────
  const onMouseUp = (e) => {
    e.preventDefault()

    if (resizing) {
      setResizing(false); setResizeHandle(null)
      setResizeStart(null); setResizeBoxOrigin(null)
      return
    }

    if (!drawing) return
    setDrawing(false)
    const end = getPos(e)
    const x=Math.min(startPos.x,end.x), y=Math.min(startPos.y,end.y)
    const w=Math.abs(end.x-startPos.x),  h=Math.abs(end.y-startPos.y)
    if (w>10 && h>10) setDraftBox({ x,y,w,h })
    setStartPos(null); setCurrentPos(null)
  }

  // ── cursor style ──────────────────────────────────────────────────────────
  const getCanvasCursor = () => {
    if (resizing && resizeHandle) return HANDLE_CURSORS[resizeHandle]
    if (hoverHandle) return HANDLE_CURSORS[hoverHandle]
    if (atLimit) return 'not-allowed'
    return 'crosshair'
  }

  // Confirm draft → add to boxes list
  const confirmBox = () => {
    if (!draftBox) return
    setBoxes(prev => [...prev, draftBox])
    setDraftBox(null); setHoverHandle(null)
  }

  // Remove a finalized box
  const removeBox = (i) => setBoxes(prev => prev.filter((_, idx) => idx !== i))

  // Discard draft
  const discardDraft = () => { setDraftBox(null); setHoverHandle(null) }

  // ── Save All & Next ───────────────────────────────────────────────────────
  const handleSaveAll = async () => {
    if (boxes.length === 0 || !image) return
    setStatus('saving')
    const cw = canvasRef.current.width, ch = canvasRef.current.height
    const normalizedBoxes = boxes.map(b => ({
      x_center: (b.x + b.w / 2) / cw,
      y_center: (b.y + b.h / 2) / ch,
      width:    b.w / cw,
      height:   b.h / ch,
    }))
    try {
      const res = await fetch('/api/annotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_id:       image.id,
          boxes:          normalizedBoxes,
          heckmatt_grade: image.grade,
          image_filename: image.filename,
          is_revisit:     isRevisit,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const updatedHistory = history.map((h, i) =>
        i === historyIndex ? { ...h, is_annotated: true } : h
      )
      setHistory(updatedHistory)
      // Exclude just-saved image once to avoid race condition, don't add to skippedIds
      fetchNext(skippedIds, updatedHistory, historyIndex, false, image.id)
    } catch { setStatus('error') }
  }

  const handleSkip = () => {
    const ns = [...skippedIds, image.id]; setSkippedIds(ns)
    fetchNext(ns, history, historyIndex)
  }

  const handlePrev = () => {
    if (historyIndex <= 0) return
    const ni = historyIndex - 1; setHistoryIndex(ni)
    loadImage(history[ni], history[ni].is_annotated)
  }

  const handleNext = () => {
    if (historyIndex < history.length - 1) {
      const ni = historyIndex + 1
      const nextImg = history[ni]
      if (nextImg && nextImg.is_annotated) {
        setHistoryIndex(ni)
        loadImage(nextImg, true)
      } else {
        fetchNext(skippedIds, history, historyIndex, true)
      }
    } else {
      const currentSaved = boxes.length > 0 || image?.is_annotated
      fetchNext(skippedIds, history, historyIndex, !currentSaved)
    }
  }

  const openBrowse = async () => {
    setShowBrowse(true); setBrowseLoading(true)
    try {
      const res = await fetch('/api/images?annotated=true&t=' + Date.now(), { cache: 'no-store' })
      const data = await res.json()
      setAnnotatedList(data.images || [])
    } catch { setAnnotatedList([]) }
    setBrowseLoading(false)
  }

  const selectFromBrowse = (img) => {
    setShowBrowse(false)
    const nh = [...history.slice(0, historyIndex + 1), { ...img, is_annotated: true }]
    setHistory(nh); setHistoryIndex(nh.length - 1)
    loadImage(img, true)
  }

  const handleExport = async () => {
    const res = await fetch('/api/export?t=' + Date.now(), { cache: 'no-store' }); const blob = await res.blob()
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'labels.zip'; a.click(); URL.revokeObjectURL(url)
  }

  const onImageLoad = (e) => {
    const img = e.target; const container = containerRef.current
    const maxW = container.clientWidth; const maxH = window.innerHeight * 0.58
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    const dW = Math.floor(img.naturalWidth * ratio); const dH = Math.floor(img.naturalHeight * ratio)
    setDisplaySize({ w:dW, h:dH })
    const canvas = canvasRef.current; canvas.width = dW; canvas.height = dH
    setImgLoaded(true)
  }

  const gradeColor = image ? GRADE_COLORS[image.grade] : '#00d4ff'
  const canSave    = boxes.length >= 1 && !hasDraft

  const canGoPrev  = historyIndex > 0

  const getInstruction = () => {
    if (hasDraft)                  return '↕ Drag the corner/edge handles to resize · then Confirm or Discard'
    if (atLimit && !hasDraft)      return `✓ Both muscles boxed — review below then click "Save & Next"`
    if (boxes.length === 0)        return `↖ Draw box around Muscle 1 (${isRevisit ? 'new boxes will replace old ones' : 'min 1, max 2'})`
    if (boxes.length === 1 && !isRevisit) return '↖ Draw box around Muscle 2 (or skip if only one muscle)'
    return '↖ Draw another box if needed'
  }

  if (!authed) return (
    <div style={S.page}>
      <div style={S.center}>
        <div style={S.lockIcon}>🔒</div>
        <div style={S.lockTitle}>Enter Passcode</div>
        <div style={S.lockSub}>Contact the study coordinator for access</div>
        <input
          type="password"
          value={passInput}
          onChange={e => { setPassInput(e.target.value); setPassError(false) }}
          onKeyDown={e => e.key === 'Enter' && handlePassSubmit()}
          placeholder="Enter passcode"
          style={{...S.passInput, borderColor: passError ? '#ef4444' : '#1e2d45'}}
          autoFocus
        />
        {passError && <div style={S.passError}>Incorrect passcode</div>}
        <button style={S.passBtn} onClick={handlePassSubmit}>Enter →</button>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.logo}>HECK<span style={{color:'#00d4ff'}}>MATT</span></span>
          <span style={S.subtitle}>USG Annotation Tool</span>
        </div>
        <div style={S.headerRight}>
          <button style={S.hBtn} onClick={openBrowse}>☰ Browse All</button>
          <button style={S.hBtn} onClick={handleExport}>↓ Export YOLO</button>
        </div>
      </header>

      <main style={S.main} ref={containerRef}>

        {/* Done */}
        {status === 'done' && (
          <div style={S.center}>
            <div style={S.doneIcon}>✓</div>
            <div style={S.doneTitle}>All images annotated</div>
            <div style={{display:'flex',gap:12,marginTop:16}}>
              <button style={S.bigBtn} onClick={handleExport}>Download YOLO Labels (.zip)</button>
              <button style={{...S.bigBtn,background:'#1e2d45',color:'#c8d8e8'}} onClick={openBrowse}>Browse Annotated</button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={S.errorBox}>
            <span style={{color:'#ef4444'}}>⚠ Connection error.</span>
            <button style={S.retryBtn} onClick={() => fetchNext(skippedIds, history, historyIndex)}>Retry</button>
          </div>
        )}

        {/* Annotator */}
        {(status === 'ready' || status === 'saving') && image && (<>

          {/* Info bar */}
          <div style={S.infoBar}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <button style={{...S.navBtn,opacity:canGoPrev?1:0.3,cursor:canGoPrev?'pointer':'default'}} onClick={handlePrev} disabled={!canGoPrev}>← Prev</button>
              <span style={S.filename}>{image.filename}</span>
              <button style={{...S.navBtn,cursor:'pointer'}} onClick={handleNext}>Next →</button>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {isRevisit && <span style={S.revisitBadge}>Revisit — boxes will overwrite</span>}
              <div style={{...S.gradeBadge,background:gradeColor+'22',border:`1px solid ${gradeColor}`,color:gradeColor}}>
                Grade {image.grade} — {GRADE_LABELS[image.grade]}
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div style={S.canvasWrapper}>
            {!imgLoaded && <div style={S.skeleton}/>}
            <div style={{position:'relative',display:imgLoaded?'block':'none'}}>
              <img src={image.url} alt={image.filename} onLoad={onImageLoad}
                style={{display:'block',width:displaySize.w||'auto',height:displaySize.h||'auto',userSelect:'none'}} draggable={false}/>
              <canvas ref={canvasRef}
                style={{...S.canvas, cursor: getCanvasCursor()}}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
                onTouchStart={onMouseDown} onTouchMove={onMouseMove} onTouchEnd={onMouseUp}/>
            </div>
          </div>

          {/* Instruction */}
          <div style={S.instruction}>{getInstruction()}</div>

          {/* Draft confirm / discard */}
          {hasDraft && (
            <div style={S.draftBar}>
              <div style={{display:'flex',flexDirection:'column',gap:3}}>
                <span style={{fontSize:12,color:'#c8d8e8',fontFamily:'IBM Plex Mono,monospace'}}>Box drawn</span>
                <span style={{fontSize:11,color:'#5a7a99',fontFamily:'IBM Plex Mono,monospace'}}>
                  {Math.round(draftBox.w)} × {Math.round(draftBox.h)} px — drag handles to resize
                </span>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button style={S.discardBtn} onClick={discardDraft}>✕ Discard</button>
                <button style={{...S.confirmBtn,background:gradeColor,color:'#000'}} onClick={confirmBox}>✓ Confirm Box</button>
              </div>
            </div>
          )}

          {/* Box list */}
          {boxes.length > 0 && (
            <div style={S.boxList}>
              {boxes.map((b, i) => (
                <div key={i} style={{...S.boxChip,borderColor:gradeColor+'66'}}>
                  <span style={{color:gradeColor,fontFamily:'IBM Plex Mono,monospace',fontSize:11}}>Muscle {i+1}</span>
                  <button style={S.removeBtn} onClick={() => removeBox(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={S.actions}>
            <button style={S.skipBtn} onClick={handleSkip} disabled={status==='saving'}>Skip →</button>
            <button
              style={{...S.saveBtn,
                background: canSave ? gradeColor : '#1e2d45',
                color:      canSave ? '#000'     : '#5a7a99',
                cursor:     canSave ? 'pointer'  : 'not-allowed',
                boxShadow:  canSave ? `0 0 20px ${gradeColor}55` : 'none',
              }}
              onClick={handleSaveAll}
              disabled={!canSave || status==='saving'}
            >
              {status==='saving' ? 'Saving...' : `Save & Next (${boxes.length} box${boxes.length!==1?'es':''})`}
            </button>
          </div>
        </>)}

        {/* Loading */}
        {status === 'loading' && (
          <div style={S.center}>
            <div style={S.spinner}/>
            <span style={{color:'#5a7a99',fontFamily:'IBM Plex Mono,monospace',fontSize:13}}>Loading...</span>
          </div>
        )}
      </main>

      {/* Browse panel */}
      {showBrowse && (
        <div style={S.overlay} onClick={() => setShowBrowse(false)}>
          <div style={S.panel} onClick={e => e.stopPropagation()}>
            <div style={S.panelHeader}>
              <span style={S.panelTitle}>Annotated Images</span>
              <button style={S.closeBtn} onClick={() => setShowBrowse(false)}>✕</button>
            </div>
            {browseLoading && <div style={{display:'flex',justifyContent:'center',padding:40}}><div style={S.spinner}/></div>}
            {!browseLoading && annotatedList.length===0 && (
              <div style={{padding:32,color:'#5a7a99',textAlign:'center',fontSize:13}}>No annotated images yet</div>
            )}
            {!browseLoading && annotatedList.map(img => (
              <div key={img.id} style={S.browseItem} onClick={() => selectFromBrowse(img)}>
                <img src={img.url} alt={img.filename} style={S.thumb}/>
                <div style={S.browseInfo}>
                  <div style={S.browseName}>{img.filename}</div>
                  <div style={{...S.pill,background:GRADE_COLORS[img.grade]+'22',color:GRADE_COLORS[img.grade],border:`1px solid ${GRADE_COLORS[img.grade]}`}}>Grade {img.grade}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}`}</style>
    </div>
  )
}

const S = {
  page:         {minHeight:'100vh',background:'#0a0e14',display:'flex',flexDirection:'column',fontFamily:"'IBM Plex Sans',sans-serif"},
  header:       {display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 32px',borderBottom:'1px solid #1e2d45',background:'#0f1520'},
  headerLeft:   {display:'flex',alignItems:'baseline',gap:12},
  logo:         {fontFamily:"'IBM Plex Mono',monospace",fontSize:18,fontWeight:600,color:'#c8d8e8',letterSpacing:'0.1em'},
  subtitle:     {fontSize:12,color:'#5a7a99',letterSpacing:'0.05em'},
  headerRight:  {display:'flex',alignItems:'center',gap:12},
  hBtn:         {padding:'8px 16px',background:'transparent',border:'1px solid #1e2d45',color:'#5a7a99',borderRadius:4,cursor:'pointer',fontSize:12,fontFamily:"'IBM Plex Mono',monospace"},
  main:         {flex:1,display:'flex',flexDirection:'column',alignItems:'center',padding:'24px 32px 32px',maxWidth:1100,width:'100%',margin:'0 auto'},
  infoBar:      {width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8},
  navBtn:       {padding:'5px 12px',background:'transparent',border:'1px solid #1e2d45',color:'#5a7a99',borderRadius:4,fontSize:11,fontFamily:"'IBM Plex Mono',monospace"},
  filename:     {fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:'#5a7a99'},
  gradeBadge:   {padding:'4px 12px',borderRadius:4,fontSize:12,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:'0.05em'},
  revisitBadge: {padding:'4px 10px',borderRadius:4,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",background:'#f9731622',border:'1px solid #f9731666',color:'#f97316'},
  canvasWrapper:{width:'100%',display:'flex',justifyContent:'center',background:'#0f1520',border:'1px solid #1e2d45',borderRadius:8,overflow:'hidden',minHeight:200},
  skeleton:     {width:'100%',minHeight:400,background:'linear-gradient(90deg,#0f1520 25%,#151d2e 50%,#0f1520 75%)',backgroundSize:'200% 100%',animation:'pulse 1.5s ease-in-out infinite'},
  canvas:       {position:'absolute',top:0,left:0,touchAction:'none'},
  instruction:  {marginTop:10,fontSize:12,color:'#5a7a99',fontFamily:"'IBM Plex Mono',monospace",alignSelf:'flex-start'},
  draftBar:     {width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:10,padding:'10px 14px',background:'#0f1520',border:'1px solid #1e2d45',borderRadius:6},
  confirmBtn:   {padding:'6px 16px',border:'none',borderRadius:4,cursor:'pointer',fontSize:12,fontFamily:"'IBM Plex Mono',monospace",fontWeight:600},
  discardBtn:   {padding:'6px 16px',background:'transparent',border:'1px solid #1e2d45',color:'#5a7a99',borderRadius:4,cursor:'pointer',fontSize:12,fontFamily:"'IBM Plex Mono',monospace"},
  boxList:      {width:'100%',display:'flex',gap:8,marginTop:8,flexWrap:'wrap'},
  boxChip:      {display:'flex',alignItems:'center',gap:8,padding:'4px 10px',background:'#0f1520',border:'1px solid',borderRadius:4},
  removeBtn:    {background:'transparent',border:'none',color:'#5a7a99',cursor:'pointer',fontSize:11,padding:'0 2px'},
  actions:      {display:'flex',gap:12,marginTop:16,alignSelf:'flex-end'},
  skipBtn:      {padding:'12px 24px',background:'transparent',border:'1px solid #1e2d45',color:'#5a7a99',borderRadius:6,cursor:'pointer',fontSize:13,fontFamily:"'IBM Plex Mono',monospace"},
  saveBtn:      {padding:'12px 32px',borderRadius:6,border:'none',fontSize:13,fontFamily:"'IBM Plex Mono',monospace",fontWeight:600,letterSpacing:'0.05em',transition:'all 0.2s'},
  center:       {flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,minHeight:400},
  spinner:      {width:32,height:32,border:'2px solid #1e2d45',borderTop:'2px solid #00d4ff',borderRadius:'50%',animation:'spin 0.8s linear infinite'},
  doneIcon:     {width:64,height:64,background:'#22c55e22',border:'1px solid #22c55e',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,color:'#22c55e'},
  doneTitle:    {fontSize:22,fontWeight:500,color:'#c8d8e8'},
  bigBtn:       {padding:'14px 32px',background:'#00d4ff',color:'#000',border:'none',borderRadius:6,cursor:'pointer',fontSize:14,fontFamily:"'IBM Plex Mono',monospace",fontWeight:600},
  errorBox:     {display:'flex',gap:16,alignItems:'center',padding:24,background:'#1a0a0a',border:'1px solid #ef444444',borderRadius:8},
  retryBtn:     {padding:'6px 16px',background:'transparent',border:'1px solid #ef4444',color:'#ef4444',borderRadius:4,cursor:'pointer',fontSize:12},
  overlay:      {position:'fixed',inset:0,background:'#00000088',zIndex:100,display:'flex',justifyContent:'flex-end'},
  panel:        {width:360,background:'#0f1520',borderLeft:'1px solid #1e2d45',height:'100vh',overflowY:'auto',display:'flex',flexDirection:'column'},
  panelHeader:  {display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 20px 16px',borderBottom:'1px solid #1e2d45',position:'sticky',top:0,background:'#0f1520',zIndex:1},
  panelTitle:   {fontFamily:"'IBM Plex Mono',monospace",fontSize:13,color:'#c8d8e8',letterSpacing:'0.08em'},
  closeBtn:     {background:'transparent',border:'none',color:'#5a7a99',cursor:'pointer',fontSize:16,padding:4},
  browseItem:   {display:'flex',gap:12,padding:'12px 20px',borderBottom:'1px solid #1e2d4555',cursor:'pointer',alignItems:'center'},
  thumb:        {width:72,height:52,objectFit:'cover',borderRadius:4,border:'1px solid #1e2d45',flexShrink:0},
  browseInfo:   {flex:1,display:'flex',flexDirection:'column',gap:6},
  browseName:   {fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:'#8aa8c8',wordBreak:'break-all'},
  pill:         {alignSelf:'flex-start',padding:'2px 8px',borderRadius:3,fontSize:11,fontFamily:"'IBM Plex Mono',monospace"},
  lockIcon:     {fontSize:40,marginBottom:8},
  lockTitle:    {fontSize:22,fontWeight:500,color:'#c8d8e8',marginBottom:4},
  lockSub:      {fontSize:12,color:'#5a7a99',fontFamily:"'IBM Plex Mono',monospace",marginBottom:24},
  passInput:    {width:280,padding:'12px 16px',background:'#0f1520',border:'1px solid',borderRadius:6,color:'#c8d8e8',fontSize:14,fontFamily:"'IBM Plex Mono',monospace",outline:'none',textAlign:'center',letterSpacing:'0.2em'},
  passError:    {fontSize:12,color:'#ef4444',fontFamily:"'IBM Plex Mono',monospace",marginTop:6},
  passBtn:      {marginTop:16,padding:'12px 40px',background:'#00d4ff',color:'#000',border:'none',borderRadius:6,cursor:'pointer',fontSize:13,fontFamily:"'IBM Plex Mono',monospace",fontWeight:600,letterSpacing:'0.08em'},
}
