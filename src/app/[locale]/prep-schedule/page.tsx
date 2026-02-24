'use client';

import { useTranslations } from 'next-intl';
import { Calendar, User, ChefHat, Check, Clock, AlertCircle, Repeat, MoonStar, Layers } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getDailyPrepTasks, completePrepTask, PrepTask, undoPrepTask, getCompletedPrepLogs } from '@/app/actions/prepSchedule';
import { getTomorrowAssignments } from '@/app/actions/nightShift';
import { getRecurringRules } from '@/app/actions/recurringPrep';
import { getPrepUsers } from '@/app/actions/users';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

export default function PrepSchedulePage() {
    const t = useTranslations();

    // Tab State
    const [activeTab, setActiveTab] = useState<'morning' | 'night' | 'recurring' | 'completed'>('morning');

    // Data States
    const [morningTasks, setMorningTasks] = useState<PrepTask[]>([]);
    const [nightAssignments, setNightAssignments] = useState<any[]>([]);
    const [recurringRules, setRecurringRules] = useState<any[]>([]);
    const [completedLogs, setCompletedLogs] = useState<any[]>([]);
    const [prepUsers, setPrepUsers] = useState<any[]>([]);

    // UI States
    const [isLoading, setIsLoading] = useState(true);
    const [actuals, setActuals] = useState<Record<string, string>>({});
    const [assignedCooks, setAssignedCooks] = useState<Record<string, string>>({});
    const [completing, setCompleting] = useState<string | null>(null);

    const loadDataForTab = async (tab: 'morning' | 'night' | 'recurring' | 'completed') => {
        setIsLoading(true);
        if (prepUsers.length === 0) {
            const users = await getPrepUsers();
            if (users.length === 0) {
                // If there are no users at all, let's create a dummy one for the UI demonstration
                setPrepUsers([{ id: 'demo-cook-1', name: 'Chef Gordon' }, { id: 'demo-cook-2', name: 'Line Cook Maria' }]);
            } else {
                setPrepUsers(users);
            }
        }
        if (tab === 'morning') {
            const dailyTasks = await getDailyPrepTasks(new Date());
            if (dailyTasks.length === 0) {
                // Dummy Data for demonstration
                setMorningTasks([
                    { ingredientId: 'demo-1', ingredientName: 'Raw White Fish', category: 'Seafood', metric: 'kg', assignedAmount: 0, forecastAmount: 8.61, recurringAmount: 5.0, actualAmount: 5.0, completed: true, hasNightShift: false, hasRecurring: true, hasForecast: true },
                    { ingredientId: 'demo-2', ingredientName: 'Fresh Limes', category: 'Produce', metric: 'kg', assignedAmount: 2.0, forecastAmount: 1.91, recurringAmount: 0, actualAmount: null, completed: false, hasNightShift: true, hasRecurring: false, hasForecast: true },
                    { ingredientId: 'demo-3', ingredientName: 'Shrimp', category: 'Seafood', metric: 'kg', assignedAmount: 0, forecastAmount: 0, recurringAmount: 5.0, actualAmount: null, completed: false, hasNightShift: false, hasRecurring: true, hasForecast: false }
                ]);
            } else {
                setMorningTasks(dailyTasks);
            }
        } else if (tab === 'night') {
            const data = await getTomorrowAssignments();
            setNightAssignments(data);
        } else if (tab === 'recurring') {
            const data = await getRecurringRules();
            setRecurringRules(data);
        } else if (tab === 'completed') {
            const data = await getCompletedPrepLogs();
            setCompletedLogs(data);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        loadDataForTab(activeTab);
    }, [activeTab]);

    const handleActualChange = (ingredientId: string, value: string) => {
        setActuals(prev => ({ ...prev, [ingredientId]: value }));
    };

    const handleCompleteTask = async (task: PrepTask) => {
        if (task.completed) return;
        let actual = parseFloat(actuals[task.ingredientId]);
        if (isNaN(actual)) {
            actual = task.assignedAmount > 0 ? task.assignedAmount : (task.recurringAmount > 0 ? task.recurringAmount : task.forecastAmount);
        }
        if (actual <= 0) return;

        let cookId = assignedCooks[task.ingredientId];
        if (!cookId) {
            alert("Please select a cook who completed this task.");
            return;
        }

        setCompleting(task.ingredientId);

        const res = await completePrepTask(task.ingredientId, actual, cookId, task.assignmentId);
        if (res.success) {
            setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: actual } : t));
        }
        setCompleting(null);
    };

    const handleUndoTask = async (task: PrepTask) => {
        if (!task.completed) return;
        setCompleting(task.ingredientId);
        const actual = task.actualAmount || 0;

        const res = await undoPrepTask(task.ingredientId, actual, task.assignmentId);
        if (res.success) {
            setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: false, actualAmount: null } : t));
        }
        setCompleting(null);
    };

    const sortedMorningTasks = [...morningTasks].sort((a, b) => Number(a.completed) - Number(b.completed));
    const allCompleted = morningTasks.length > 0 && morningTasks.every(t => t.completed);

    const renderMorningPrep = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem', justifyContent: 'space-between' }}>
                {/* Legend on the Left */}
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <MoonStar size={16} color="var(--warning)" />
                        </div>
                        {t('PrepSchedule.legend_night')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <Calendar size={16} color="#a855f7" />
                        </div>
                        {t('PrepSchedule.legend_scheduled')}
                    </div>
                </div>

                {/* Pending & Completed on the Right */}
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Clock size={18} color="var(--warning)" />
                        <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.pending', { count: morningTasks.filter(t => !t.completed).length })}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Check size={18} color="var(--success)" />
                        <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.completed', { count: morningTasks.filter(t => t.completed).length })}</span>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sortedMorningTasks.map((task, idx) => {
                        const isDone = task.completed;
                        const isProcessing = completing === task.ingredientId;

                        let recommendedTarget = task.forecastAmount;
                        if (task.hasRecurring) recommendedTarget = task.recurringAmount;
                        if (task.hasNightShift) recommendedTarget = task.assignedAmount;

                        // Visual Source Icon Block mapping
                        let originIcon = null;
                        let originBg = 'transparent';
                        let originTitle = '';

                        if (task.hasNightShift) {
                            originIcon = <MoonStar size={24} color="var(--warning)" />;
                            originBg = 'rgba(245, 158, 11, 0.1)';
                            originTitle = 'Night Shift Manual Override';
                        } else if (task.hasRecurring) {
                            originIcon = <Calendar size={24} color="#a855f7" />;
                            originBg = 'rgba(168, 85, 247, 0.1)';
                            originTitle = 'Recurring Schedule Rule';
                        }

                        if (isDone && originIcon) {
                            originIcon = <Check size={24} color="var(--success)" />;
                            originBg = 'rgba(16, 185, 129, 0.2)';
                        }

                        return (
                            <div key={task.ingredientId || idx} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '1.2rem 1.5rem',
                                background: isDone ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.02)',
                                border: isDone ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(255,255,255,0.05)',
                                borderRadius: '16px', transition: 'all 0.3s', opacity: isDone ? 0.6 : 1
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flex: 1 }}>

                                    {/* First Column: Source Indicator */}
                                    {originIcon && (
                                        <div title={originTitle} style={{ background: originBg, padding: '1rem', borderRadius: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                            {originIcon}
                                        </div>
                                    )}

                                    <div>
                                        <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1.2rem', textDecoration: isDone ? 'line-through' : 'none' }}>
                                            {task.ingredientName}
                                        </h3>
                                        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.9rem', flexWrap: 'wrap' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>
                                                {task.category}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Area */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>

                                    {/* Recommended Quantity */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem', paddingRight: '1rem' }}>
                                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('PrepSchedule.recommended_amount')}</label>
                                        <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-secondary)', minWidth: '80px', textAlign: 'center', cursor: 'not-allowed', border: '1px dashed rgba(255,255,255,0.1)' }}>
                                            {recommendedTarget} {task.metric}
                                        </div>
                                    </div>

                                    {/* Prepped Amount */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
                                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('PrepSchedule.actual_prepped')}</label>
                                        {isDone ? (
                                            <div style={{ background: 'white', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '1.2rem', fontWeight: 600, color: 'var(--success)', minWidth: '100px', textAlign: 'center', border: '2px solid var(--success)' }}>
                                                {task.actualAmount} {task.metric}
                                            </div>
                                        ) : (
                                            <input
                                                type="number" step="0.01"
                                                placeholder={recommendedTarget.toString()}
                                                value={actuals[task.ingredientId] || ''}
                                                onChange={(e) => handleActualChange(task.ingredientId, e.target.value)}
                                                style={{ width: '100px', textAlign: 'center', fontSize: '1.2rem', background: 'white', color: 'black', border: '2px solid var(--accent-primary)', borderRadius: '8px', padding: '0.5rem' }}
                                            />
                                        )}
                                    </div>

                                    {/* Select Cook & Complete Button */}
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', marginLeft: '1rem' }}>
                                        {!isDone && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('PrepSchedule.completed_by')}</label>
                                                <SearchableSelect
                                                    value={assignedCooks[task.ingredientId] || ''}
                                                    onChange={(val) => setAssignedCooks(prev => ({ ...prev, [task.ingredientId]: val }))}
                                                    options={prepUsers.map(u => ({ value: u.id, label: u.name }))}
                                                    placeholder={t('PrepSchedule.select_user') || 'Select User'}
                                                />
                                            </div>
                                        )}

                                        {!isDone ? (
                                            <button className="btn-primary" onClick={() => handleCompleteTask(task)} disabled={isProcessing} style={{ padding: '0.8rem 1.5rem', borderRadius: '12px', height: 'fit-content' }}>
                                                {isProcessing ? t('PrepSchedule.saving') : t('PrepSchedule.complete_btn')}
                                            </button>
                                        ) : (
                                            <button onClick={() => handleUndoTask(task)} disabled={isProcessing} style={{ padding: '0.8rem 1.5rem', borderRadius: '12px', height: 'fit-content', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                                                {isProcessing ? '..' : 'Undo'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Final Submit Button */}
                    <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn-primary" disabled={!allCompleted} onClick={() => alert("All tasks submitted!")} style={{ padding: '1rem 2rem', borderRadius: '12px', fontSize: '1.2rem', opacity: allCompleted ? 1 : 0.5, cursor: allCompleted ? 'pointer' : 'not-allowed' }}>
                            Submit All Tasks
                        </button>
                    </div>
                </div>
            )}
        </div>
    );

    const renderNightShift = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('PrepSchedule.override_desc_2')}</p>
                <button className="btn-secondary" style={{ padding: '0.6rem 1.2rem', borderRadius: '12px', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Calendar size={18} /> {t('PrepSchedule.tomorrow', { date: new Date(new Date().setDate(new Date().getDate() + 1)).toLocaleDateString(t('Nav.sales') === 'Ventas' ? 'es-ES' : 'en-US', { weekday: 'long' }) })}
                </button>
            </div>
            {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
            ) : nightAssignments.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                    <MoonStar size={40} style={{ opacity: 0.3, margin: '0 auto 1rem auto' }} />
                    <p>{t('PrepSchedule.no_overrides')}</p>
                    <button className="btn-primary" style={{ marginTop: '1rem' }}>{t('PrepSchedule.new_override')}</button>
                </div>
            ) : (
                nightAssignments.map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <strong style={{ fontSize: '1.1rem' }}>{a.ingredient.name}</strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{a.ingredient.category.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('PrepSchedule.target_assigned')}</span>
                                <div style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', padding: '0.4rem 0.8rem', borderRadius: '8px', fontWeight: 'bold' }}>
                                    {a.portionsAssigned} kg
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );

    const renderRecurringPrep = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('PrepSchedule.recurring_desc')}</p>
                <button className="btn-primary" style={{ padding: '0.6rem 1.2rem', borderRadius: '12px' }}>{t('PrepSchedule.new_recurring')}</button>
            </div>
            {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, idx) => {
                        const dayRules = recurringRules.filter(r => r.dayOfWeek === idx);
                        // Convert days to Spanish if using Spanish local
                        const displayDay = t('Nav.sales') === 'Ventas' ? ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][idx] : day;

                        return (
                            <div key={day} className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.01)' }}>
                                <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
                                    <Calendar size={18} color={dayRules.length > 0 ? "var(--accent-primary)" : "var(--text-secondary)"} /> {displayDay}
                                </h3>
                                {dayRules.length === 0 ? (
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' }}>{t('PrepSchedule.no_tasks')}</div>
                                ) : (
                                    dayRules.map(rule => (
                                        <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '0.8rem', borderRadius: '8px', marginBottom: '0.5rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <strong style={{ fontSize: '1rem' }}>{rule.ingredient.name}</strong>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rule.ingredient.category.name}</span>
                                            </div>
                                            <div style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', padding: '0.3rem 0.6rem', borderRadius: '8px', fontWeight: 'bold' }}>
                                                {rule.amount} kg
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );

    const renderCompletedLogs = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>View a historical log of completed prep duties and assignments.</p>
            </div>
            {isLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
            ) : completedLogs.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                    <p>No completed logs found.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {completedLogs.map(log => (
                        <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <strong style={{ fontSize: '1.1rem' }}>{log.ingredientName}</strong>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{log.category} • Prepped by {log.completedBy}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Amount</span>
                                    <div style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                                        {log.actualAmount} kg
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {new Date(log.completedAt).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>{t('PrepSchedule.title')}</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.subtitle')}</p>
                </div>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.5rem', borderRadius: '16px' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.2)', padding: '0.8rem', borderRadius: '12px' }}>
                        <Layers size={24} color="var(--accent-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('PrepSchedule.focus_date')}</div>
                        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{new Date().toLocaleDateString(t('Nav.sales') === 'Ventas' ? 'es-ES' : 'en-US', { weekday: 'short', month: 'long', day: 'numeric' })}</div>
                    </div>
                </div>
            </div>

            {/* Main Tabs Container */}
            <div className="glass-panel" style={{ padding: '0' }}>

                {/* Tab Controls */}
                <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.1)' }}>
                    <button
                        onClick={() => setActiveTab('morning')}
                        style={{ flex: 1, padding: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'morning' ? '2px solid var(--accent-primary)' : '2px solid transparent', color: activeTab === 'morning' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'morning' ? 600 : 400, fontSize: '1.1rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <ChefHat size={20} color={activeTab === 'morning' ? 'var(--accent-primary)' : 'inherit'} />
                        {t('PrepSchedule.tab_morning')}
                    </button>
                    <button
                        onClick={() => setActiveTab('night')}
                        style={{ flex: 1, padding: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'night' ? '2px solid var(--warning)' : '2px solid transparent', color: activeTab === 'night' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'night' ? 600 : 400, fontSize: '1.1rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <MoonStar size={20} color={activeTab === 'night' ? 'var(--warning)' : 'inherit'} />
                        {t('PrepSchedule.tab_night')}
                    </button>
                    <button
                        onClick={() => setActiveTab('recurring')}
                        style={{ flex: 1, padding: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'recurring' ? '2px solid #a855f7' : '2px solid transparent', color: activeTab === 'recurring' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'recurring' ? 600 : 400, fontSize: '1.1rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <Repeat size={20} color={activeTab === 'recurring' ? '#a855f7' : 'inherit'} />
                        {t('PrepSchedule.tab_recurring')}
                    </button>
                    <button
                        onClick={() => setActiveTab('completed')}
                        style={{ flex: 1, padding: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'completed' ? '2px solid var(--success)' : '2px solid transparent', color: activeTab === 'completed' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'completed' ? 600 : 400, fontSize: '1.1rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <Check size={20} color={activeTab === 'completed' ? 'var(--success)' : 'inherit'} />
                        Completed Logs
                    </button>
                </div>

                {/* Tab Output Section */}
                <div style={{ padding: '2rem' }}>
                    {activeTab === 'morning' && renderMorningPrep()}
                    {activeTab === 'night' && renderNightShift()}
                    {activeTab === 'recurring' && renderRecurringPrep()}
                    {activeTab === 'completed' && renderCompletedLogs()}
                </div>

            </div>
        </div>
    );
}
