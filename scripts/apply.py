import os

path = os.path.join(os.path.dirname(__file__), '../src/app/[locale]/recetario/page.tsx')
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Overview chunk
overview_chunk = """{/* Overview */}
                <div style={{ marginBottom: '2.5rem' }}>
                    {docData.type === 'EMPLATADO' && (
                        <div style={{ marginBottom: '1.5rem' }}>
                           <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Foto Plato Final' : 'Final Plated Photo'}</h3>
                           {isEditing ? (
                               <input value={mediaData.finalPhotoUrl} onChange={e => setEditData({...docData, mediaJson: JSON.stringify({ ...mediaData, finalPhotoUrl: e.target.value })})} placeholder="URL de imagen (ej. https://...)" style={{ width: '100%', padding: '0.6rem', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)' }} />
                           ) : (
                               mediaData.finalPhotoUrl ? (
                                   <div style={{ maxWidth: '400px', cursor: 'pointer' }} onClick={() => window.open(mediaData.finalPhotoUrl, '_blank')}>
                                       <img src={mediaData.finalPhotoUrl} alt="Plato Final" style={{ width: '100%', borderRadius: '8px', border: '2px solid var(--border)' }} />
                                   </div>
                               ) : (
                                   <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Sin imagen final.</span>
                               )
                           )}
                        </div>
                    )}

                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Visión General' : 'Overview'}</h3>"""

import re
content = re.sub(r'\{\/\* Overview \*\/\}\s*<div style=\{\{ marginBottom: \'2\.5rem\' \}\}>\s*<h3 style=\{\{ fontSize: \'1\.1rem\', color: \'var\(--text-secondary\)\', marginBottom: \'0\.5rem\', textTransform: \'uppercase\', letterSpacing: \'1px\' \}\}>\{locale === \'es\' \? \'Visión General\' : \'Overview\'\}<\/h3>', overview_chunk, content)

# 2. Procedure List replacement
proc_start = content.find('{/* Procedure List */}')
proc_end = content.find('{/* Chef Notes */}')

plating_ui = """                {/* Procedure List or Plating Tracks */}
                {docData.type === 'EMPLATADO' ? (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
                                {locale === 'es' ? 'Flujo de Emplatado Simultáneo' : 'Simultaneous Plating Workflow'}
                            </h3>
                            {isEditing && (
                                <button type="button" onClick={addPlatingTrack} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <Plus size={14} /> {locale === 'es' ? 'Agregar Pista (Track)' : 'Add Track'}
                                </button>
                            )}
                        </div>

                        {platingData.tracks.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                                {locale === 'es' ? 'Agrega una pista (e.g. Proteína) para comenzar.' : 'Add a track to start.'}
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: `auto repeat(${platingData.tracks.length}, minmax(280px, 1fr)) ${isEditing ? '40px' : ''}`, gap: '1rem', alignItems: 'start' }}>
                                    
                                    {/* Header Row */}
                                    <div style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}></div>
                                    {platingData.tracks.map((track: any) => (
                                        <div key={track.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                            {isEditing ? (
                                                <input value={track.name} onChange={e => updatePlatingTrack(track.id, e.target.value)} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontWeight: 'bold', outline: 'none', width: '100%' }} placeholder="Nombre de Pista" />
                                            ) : (
                                                <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)', fontSize: '1.1rem' }}>{track.name}</span>
                                            )}
                                            {isEditing && (
                                                <button type="button" onClick={() => removePlatingTrack(track.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><X size={16}/></button>
                                            )}
                                        </div>
                                    ))}
                                    {isEditing && <div></div>}

                                    {/* Rows mapped */}
                                    {platingData.rows.map((row: any, rIdx: number) => (
                                        <React.Fragment key={row.id}>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', paddingTop: '0.8rem' }}>
                                                <div style={{ background: row.isSimultaneous ? 'var(--accent-primary)' : 'var(--border)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 'bold' }}>
                                                    {rIdx + 1}
                                                </div>
                                                {isEditing && (
                                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', background: row.isSimultaneous?'rgba(59,130,246,0.1)':'transparent', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                        <input type="checkbox" checked={row.isSimultaneous} onChange={e => updatePlatingRow(row.id, e.target.checked)} />
                                                        Simult.
                                                    </label>
                                                )}
                                                {!isEditing && row.isSimultaneous && (
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 'bold', letterSpacing: '1px' }}>SIMULT.</span>
                                                )}
                                            </div>

                                            {platingData.tracks.map((track: any) => {
                                                const cellData = row.cells[track.id] || { text: '', imageUrl: '' };
                                                const isActive = bool(cellData.text or cellData.imageUrl) if "bool" not in locals() else (bool if False else (cellData.text or cellData.imageUrl));
                                                // Wait doing this in python strings needs care, JS syntax:
                                                const isActiveJs = `!!(cellData.text || cellData.imageUrl)`;
                                                return (
                                                    <div key={track.id} style={{ 
                                                        padding: '0.8rem',
                                                        background: isEditing ? 'rgba(0,0,0,0.15)' : (cellData.text || cellData.imageUrl ? 'var(--bg-secondary)' : 'transparent'),
                                                        border: isEditing ? '1px dashed var(--border)' : (cellData.text || cellData.imageUrl ? (row.isSimultaneous ? '2px solid rgba(59, 130, 246, 0.4)' : '1px solid var(--border)') : '1px dashed rgba(255,255,255,0.05)'),
                                                        borderRadius: '8px',
                                                        display: 'flex', flexDirection: 'column', gap: '0.8rem',
                                                        boxShadow: (!isEditing && row.isSimultaneous && (cellData.text || cellData.imageUrl)) ? '0 0 10px rgba(59, 130, 246, 0.1)' : 'none',
                                                        height: '100%'
                                                    }}>
                                                        {isEditing ? (
                                                            <>
                                                                <textarea placeholder="Descripción del paso..." value={cellData.text} onChange={e => updatePlatingCell(row.id, track.id, e.target.value, cellData.imageUrl)} rows={3} style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '0.6rem', color: 'var(--text-primary)', resize: 'vertical', borderRadius: '4px', fontSize: '0.9rem' }} />
                                                                <input placeholder="URL Foto Ref (Opcional)" value={cellData.imageUrl || ''} onChange={e => updatePlatingCell(row.id, track.id, cellData.text, e.target.value)} style={{ width: '100%', background: 'var(--bg-primary)', border: '1px dashed var(--border)', padding: '0.4rem', color: 'var(--text-secondary)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                            </>
                                                        ) : (
                                                            <>
                                                                {(cellData.text || cellData.imageUrl) ? (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                                        <span style={{ fontSize: '0.95rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{renderBoldText(cellData.text)}</span>
                                                                        {cellData.imageUrl && (
                                                                            <img src={cellData.imageUrl} alt="Referencia" style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--border)', maxHeight: '200px', objectFit: 'cover' }} />
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                        <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.2)' }}>-</span>
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                )
                                            })}

                                            {/* Delete Row Button */}
                                            {isEditing && (
                                                <div style={{ paddingTop: '0.8rem', textAlign: 'center' }}>
                                                    <button type="button" onClick={() => removePlatingRow(row.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}><Trash2 size={18}/></button>
                                                </div>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </div>

                                {isEditing && (
                                <button type="button" onClick={addPlatingRow} style={{ marginTop: '1.5rem', background: 'transparent', border: '2px dashed var(--accent-primary)', padding: '0.8rem', width: '100%', color: 'var(--text-primary)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 600 }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                                    <Plus size={18} /> Agregar Pasos (Time Block)
                                </button>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Procedimiento' : 'Procedure'}</h3>
                            {isEditing && (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {locale === 'es' ? 'Use **texto** para negrita' : 'Use **text** for bold'}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', counterReset: 'step-counter' }}>
                            {procList.map((step: string, idx: number) => (
                                <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                    <div style={{ background: 'var(--accent-primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem', flexShrink: 0, marginTop: '2px' }}>
                                        {idx + 1}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <textarea value={step} onChange={e => updateProcedure(idx, e.target.value)} rows={2} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '0.5rem', color: 'var(--text-primary)', resize: 'vertical' }} />
                                                <button type="button" onClick={() => removeProcedureRow(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}><X size={16} /></button>
                                            </div>
                                        ) : (
                                            <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{renderBoldText(step)}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {isEditing && (
                            <button type="button" onClick={addProcedureRow} style={{ marginTop: '1rem', background: 'transparent', border: '1px dashed var(--border)', padding: '0.5rem', width: '100%', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                                + {locale === 'es' ? 'Agregar Paso' : 'Add Step'}
                            </button>
                        )}
                    </div>
                )}
"""

content = content[:proc_start] + plating_ui + content[proc_end:]

content = content.replace("import { useState, useEffect } from 'react';", "import React, { useState, useEffect } from 'react';")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Applied beautifully")
