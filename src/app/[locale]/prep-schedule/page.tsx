'use client';

import { useTranslations } from 'next-intl';
import { Calendar, User, ChefHat, Check, Clock, AlertCircle, Repeat, MoonStar, Layers, Users, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getDailyPrepTasks, completePrepTask, PrepTask, undoPrepTask, getCompletedPrepLogs, createManualPrepAssignment, deletePrepAssignment } from '@/app/actions/prepSchedule';
import { getAssignmentsForDate, assignNightShiftTasks } from '@/app/actions/nightShift';
import { getRecurringRules, createRecurringRule, deleteRecurringRule } from '@/app/actions/recurringPrep';
import { getPrepUsers } from '@/app/actions/users';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { getTeamMembers, addTeamMember, removeTeamMember, getPrepTaskItems, addPrepTaskItem, removePrepTaskItem, getBaseIngredients } from '@/app/actions/teamTasks';
import { getCategories } from '@/app/actions/inventory';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

export default function PrepSchedulePage() {
    const t = useTranslations();

    // Tab State
    const [activeTab, setActiveTab] = useState<'morning' | 'night' | 'recurring' | 'completed' | 'team'>('morning');
    const [morningDate, setMorningDate] = useState<Date>(new Date());

    // Data States
    const [morningTasks, setMorningTasks] = useState<PrepTask[]>([]);
    const [tomorrowTasks, setTomorrowTasks] = useState<PrepTask[]>([]);
    const [nightAssignments, setNightAssignments] = useState<any[]>([]);
    const [recurringRules, setRecurringRules] = useState<any[]>([]);
    const [completedLogs, setCompletedLogs] = useState<any[]>([]);
    const [prepUsers, setPrepUsers] = useState<any[]>([]);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [prepItems, setPrepItems] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);

    // UI States
    const [isLoading, setIsLoading] = useState(true);
    const [actuals, setActuals] = useState<Record<string, string>>({});
    const [assignedCooks, setAssignedCooks] = useState<Record<string, string>>({});
    const [completing, setCompleting] = useState<string | null>(null);

    // Delete Modal State
    const [deleteTaskCandidate, setDeleteTaskCandidate] = useState<PrepTask | null>(null);
    const [deleteTaskReason, setDeleteTaskReason] = useState<'NOT_NECESSARY' | 'MISTAKE' | null>(null);
    const [deleteTaskCook, setDeleteTaskCook] = useState<string>('');
    const [isTodayTasks, setIsTodayTasks] = useState(false);

    // Night Shift form state
    const [nightDrafts, setNightDrafts] = useState<Record<string, { selected: boolean, qty: string, userId: string, urgent: boolean }>>({});
    const [baseIngredients, setBaseIngredients] = useState<any[]>([]);

    const [targetAssignDate, setTargetAssignDate] = useState<string>(() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    });

    const [manualTask, setManualTask] = useState('');
    const [manualAmount, setManualAmount] = useState('');
    const [manualUrgent, setManualUrgent] = useState(false);

    const handleAddManualTask = async () => {
        if (!manualTask) return;
        setIsLoading(true);
        await createManualPrepAssignment(manualTask, morningDate, manualUrgent, parseFloat(manualAmount || '0'));
        await loadDataForTab('morning');
        setManualTask('');
        setManualAmount('');
        setManualUrgent(false);
        setIsLoading(false);
    };

    const [showRecurringForm, setShowRecurringForm] = useState(false);
    const [newRecurringTask, setNewRecurringTask] = useState('');
    const [newRecurringDay, setNewRecurringDay] = useState('0');
    const [newRecurringAmount, setNewRecurringAmount] = useState('');

    const handleCreateRecurringRule = async () => {
        if (!newRecurringTask || !newRecurringAmount) return;
        setIsLoading(true);
        await createRecurringRule(newRecurringTask, parseInt(newRecurringDay), parseFloat(newRecurringAmount));
        setRecurringRules(await getRecurringRules());
        setShowRecurringForm(false);
        setNewRecurringTask('');
        setNewRecurringAmount('');
        setIsLoading(false);
    };

    const handleRemoveRecurringRule = async (id: string) => {
        if (!confirm("Delete this recurring rule?")) return;
        setIsLoading(true);
        await deleteRecurringRule(id);
        setRecurringRules(await getRecurringRules());
        setIsLoading(false);
    };

    useEffect(() => {
        if (activeTab === 'night') {
            const drafts: Record<string, any> = {};
            prepItems.forEach(item => {
                const existing = nightAssignments.find(a => a.ingredientId === item.id);
                drafts[item.id] = {
                    selected: !!existing,
                    qty: existing ? existing.portionsAssigned.toString() : '',
                    userId: existing ? existing.userId : '',
                    urgent: existing ? existing.isUrgent : false
                };
            });
            setNightDrafts(drafts);
        }
    }, [nightAssignments, prepItems, activeTab]);

    useEffect(() => {
        if (activeTab === 'night') {
            loadDataForTab('night');
        }
    }, [targetAssignDate]);

    const loadDataForTab = async (tab: 'morning' | 'night' | 'recurring' | 'completed' | 'team') => {
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
            const todayDate = new Date();
            const tmwDate = new Date();
            tmwDate.setDate(tmwDate.getDate() + 1);

            const [todayData, tomorrowData, items] = await Promise.all([
                getDailyPrepTasks(todayDate),
                getDailyPrepTasks(tmwDate),
                getPrepTaskItems()
            ]);
            setMorningTasks(todayData);
            setTomorrowTasks(tomorrowData);
            setPrepItems(items);
        } else if (tab === 'night') {
            const dateObj = new Date(targetAssignDate);
            // Adjust for timezone offset to ensure it lands on the local date intended
            const tzDate = new Date(dateObj.getTime() + dateObj.getTimezoneOffset() * 60000);
            const [assignments, members, tasks] = await Promise.all([getAssignmentsForDate(tzDate), getTeamMembers(), getPrepTaskItems()]);
            setNightAssignments(assignments);
            setTeamMembers(members);
            setPrepItems(tasks);
        } else if (tab === 'recurring') {
            const [data, tasks] = await Promise.all([getRecurringRules(), getPrepTaskItems()]);
            setRecurringRules(data);
            setPrepItems(tasks);
        } else if (tab === 'completed') {
            const data = await getCompletedPrepLogs();
            setCompletedLogs(data);
        } else if (tab === 'team') {
            const [members, tasks, cats, bases] = await Promise.all([getTeamMembers(), getPrepTaskItems(), getCategories(), getBaseIngredients()]);
            setTeamMembers(members);
            setPrepItems(tasks);
            setCategories(cats);
            setBaseIngredients(bases);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        loadDataForTab(activeTab);
    }, [activeTab, morningDate]);

    const handleActualChange = (ingredientId: string, value: string) => {
        setActuals(prev => ({ ...prev, [ingredientId]: value }));
    };

    const handleCompleteTask = async (task: PrepTask) => {
        if (task.completed) return;
        let actual = parseFloat(actuals[task.ingredientId]);
        if (isNaN(actual)) {
            actual = task.assignedAmount > 0 ? task.assignedAmount : (task.recurringAmount > 0 ? task.recurringAmount : 0);
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
            setTomorrowTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: actual } : t));
        }
        setCompleting(null);
    };

    const handleConfirmDeleteComplete = async () => {
        if (!deleteTaskCandidate || !deleteTaskReason) return;
        const task = deleteTaskCandidate;

        setCompleting(task.ingredientId);

        if (deleteTaskReason === 'MISTAKE') {
            if (task.assignmentId) {
                await deletePrepAssignment(task.assignmentId);
            }
            if (isTodayTasks) {
                setMorningTasks(prev => prev.filter(t => t.ingredientId !== task.ingredientId));
            } else {
                setTomorrowTasks(prev => prev.filter(t => t.ingredientId !== task.ingredientId));
            }
        } else if (deleteTaskReason === 'NOT_NECESSARY') {
            if (!deleteTaskCook) {
                alert("Please select a cook.");
                setCompleting(null);
                return;
            }
            const cook = prepUsers.find(u => u.id === deleteTaskCook);
            const cookName = cook ? cook.name : 'Unknown Cook';
            const res = await completePrepTask(task.ingredientId, 0, deleteTaskCook, task.assignmentId, `Not Necessary, skipped by ${cookName}`);
            if (res.success) {
                if (isTodayTasks) setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: 0 } : t));
                else setTomorrowTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: 0 } : t));
            } else {
                alert("Error updating task.");
            }
        }

        setDeleteTaskCandidate(null);
        setDeleteTaskReason(null);
        setDeleteTaskCook('');
        setCompleting(null);
    };

    const handleUndoTask = async (task: PrepTask) => {
        if (!task.completed) return;
        setCompleting(task.ingredientId);
        const actual = task.actualAmount || 0;

        const res = await undoPrepTask(task.ingredientId, actual, task.assignmentId);
        if (res.success) {
            setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: false, actualAmount: null } : t));
            setTomorrowTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: false, actualAmount: null } : t));
        }
        setCompleting(null);
    };

    const sortedMorningTasks = [...morningTasks].sort((a, b) => Number(a.completed) - Number(b.completed));
    const sortedTomorrowTasks = [...tomorrowTasks].sort((a, b) => Number(a.completed) - Number(b.completed));

    const renderTaskTable = (tasksObj: PrepTask[], title: string, emptyMessage: string, isTodayList: boolean) => {
        if (tasksObj.length === 0) return (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                <Layers size={30} style={{ opacity: 0.3, margin: '0 auto 1rem auto' }} />
                <p>{emptyMessage}</p>
            </div>
        );

        // Group by Category -> Parent Ingredient
        const grouped: Record<string, Record<string, PrepTask[]>> = {};
        tasksObj.forEach(item => {
            const cat = item.isUrgent ? '🚨 URGENT' : (item.category || 'Uncategorized');
            const parent = item.parentName || 'Base Tasks';
            if (!grouped[cat]) grouped[cat] = {};
            if (!grouped[cat][parent]) grouped[cat][parent] = [];
            grouped[cat][parent].push(item);
        });

        return (
            <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontWeight: 'bold' }}>{title}</h3>
                <div className="glass-panel" style={{ overflowX: 'auto', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1000px' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', width: '60px' }}></th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_category')}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Base / {t('PrepSchedule.th_ingredient')}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_task')}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>{t('Nav.sales') === 'Ventas' ? 'Cantidad a Preparar' : 'Target'}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', minWidth: '120px' }}>{t('Nav.sales') === 'Ventas' ? 'Cantidad Preparada' : 'Actual'}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>Unidad de Medida</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', minWidth: '150px' }}>Preparador</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.keys(grouped).sort((a, b) => a === '🚨 URGENT' ? -1 : (b === '🚨 URGENT' ? 1 : a.localeCompare(b))).map(catName => {
                                const parents = grouped[catName];
                                const catRows = Object.keys(parents).reduce((sum, p) => sum + parents[p].length, 0);
                                let isFirstCatRow = true;

                                return Object.keys(parents).sort().map(parentName => {
                                    const tasks = parents[parentName].sort((a, b) => {
                                        if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
                                        return a.ingredientName.localeCompare(b.ingredientName);
                                    });
                                    const parRows = tasks.length;
                                    let isFirstParRow = true;

                                    return tasks.map(task => {
                                        const renderCat = isFirstCatRow;
                                        const renderPar = isFirstParRow;
                                        isFirstCatRow = false;
                                        isFirstParRow = false;

                                        const isDone = task.completed;
                                        const isProcessing = completing === task.ingredientId;

                                        let recommendedTarget = 0;
                                        if (task.hasRecurring) recommendedTarget = task.recurringAmount;
                                        if (task.hasNightShift) recommendedTarget = task.assignedAmount;
                                        if (!task.hasRecurring && !task.hasNightShift) recommendedTarget = task.assignedAmount || 0; // Manual tasks

                                        return (
                                            <tr key={task.ingredientId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: isDone ? 'rgba(0,0,0,0.2)' : 'transparent', opacity: isDone ? 0.6 : 1, transition: 'background 0.2s' }}>
                                                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                    {task.isUrgent ? (
                                                        <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                                            <AlertCircle size={18} color="var(--danger)" />
                                                        </div>
                                                    ) : task.hasNightShift ? (
                                                        <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                                            <MoonStar size={18} color="var(--warning)" />
                                                        </div>
                                                    ) : task.hasRecurring ? (
                                                        <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                                            <Calendar size={18} color="#a855f7" />
                                                        </div>
                                                    ) : null}
                                                </td>
                                                {renderCat && <td rowSpan={catRows} style={{ padding: '1rem', verticalAlign: 'middle', fontWeight: 'bold', borderRight: '1px solid rgba(255,255,255,0.05)' }}>{catName}</td>}
                                                {renderPar && <td rowSpan={parRows} style={{ padding: '1rem', verticalAlign: 'middle', color: 'var(--text-secondary)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>{parentName}</td>}
                                                <td style={{ padding: '0.8rem 1rem' }}>
                                                    <span style={{ fontSize: '0.95rem', textDecoration: isDone ? 'line-through' : 'none' }}>{task.ingredientName}</span>
                                                </td>
                                                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                    <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{recommendedTarget}</span>
                                                </td>
                                                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                    {isDone ? (
                                                        <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--success)' }}>{task.actualAmount}</span>
                                                    ) : (
                                                        <input type="number" step="0.01" min="0" placeholder={recommendedTarget.toString()} value={actuals[task.ingredientId] || ''} onChange={(e) => handleActualChange(task.ingredientId, e.target.value)} style={{ width: '60px', padding: '0.3rem', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', outline: 'none', background: 'white', color: 'black', textAlign: 'center', fontWeight: 'bold' }} />
                                                    )}
                                                </td>
                                                <td style={{ padding: '0.8rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                    {(() => {
                                                        const itemData = prepItems.find(p => p.id === task.ingredientId);
                                                        const isEditable = itemData && (!itemData.parent && itemData.type === 'PREP'); // Not associated with a child ingredient logically

                                                        if (!isDone && isEditable && !task.parentName) {
                                                            return (
                                                                <select
                                                                    disabled // Locked to target metric by default
                                                                    value={task.metric}
                                                                    style={{ padding: '0.3rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit', borderRadius: '4px' }}
                                                                >
                                                                    <option value={task.metric}>{task.metric}</option>
                                                                </select>
                                                            );
                                                        }
                                                        return task.metric;
                                                    })()}
                                                </td>
                                                <td style={{ padding: '0.8rem 1rem' }}>
                                                    {!isDone && (
                                                        <select value={assignedCooks[task.ingredientId] || ''} onChange={(e) => setAssignedCooks(prev => ({ ...prev, [task.ingredientId]: e.target.value }))} style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.2)' }}>
                                                            <option value="">{t('PrepSchedule.select_user') || 'Select...'}</option>
                                                            {prepUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                                        </select>
                                                    )}
                                                </td>
                                                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                    {isProcessing ? (
                                                        <div className="spinner" style={{ width: '20px', height: '20px', margin: '0 auto', borderTopColor: 'var(--accent-primary)' }} />
                                                    ) : isDone ? (
                                                        <button onClick={() => handleUndoTask(task)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.85rem' }}>Undo</button>
                                                    ) : (
                                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                                            <button onClick={() => handleCompleteTask(task)} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>Complete</button>
                                                            <button onClick={() => {
                                                                setIsTodayTasks(isTodayList);
                                                                setDeleteTaskCandidate(task);
                                                            }} className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', color: 'white', background: 'var(--danger)', border: 'none' }}>
                                                                {t('Nav.sales') === 'Ventas' ? 'Borrar' : 'Delete'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    });
                                });
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderMorningPrep = () => {
        const tmwDateStr = new Date(new Date().setDate(new Date().getDate() + 1)).toLocaleDateString(t('Nav.sales') === 'Ventas' ? 'es-ES' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
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

                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Clock size={18} color="var(--warning)" />
                            <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.pending', { count: morningTasks.filter(t => !t.completed).length + tomorrowTasks.filter(t => !t.completed).length })}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Check size={18} color="var(--success)" />
                            <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.completed', { count: morningTasks.filter(t => t.completed).length + tomorrowTasks.filter(t => t.completed).length })}</span>
                        </div>
                    </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: '200px', zIndex: 10 }}>
                        <SearchableSelect
                            value={manualTask}
                            onChange={(val) => setManualTask(val)}
                            options={[
                                { value: '', label: t('PrepSchedule.add_manual_today') },
                                ...prepItems.map(item => ({
                                    value: item.id,
                                    label: item.name,
                                    category: item.category?.name || 'Uncategorized'
                                }))
                            ]}
                            placeholder={t('PrepSchedule.add_manual_today')}
                        />
                    </div>
                    <div style={{ flex: 1, minWidth: '160px', display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid rgba(150,150,150,0.3)', borderRadius: '8px' }}>
                        <input type="number" step="0.01" min="0" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder={t('Nav.sales') === 'Ventas' ? 'Cantidad' : 'Cantidad'} style={{ flex: 1, width: '80px', padding: '0.6rem', background: 'transparent', color: 'var(--text-primary)', border: 'none', outline: 'none' }} />
                        <div style={{ borderLeft: '1px solid rgba(150,150,150,0.3)', alignSelf: 'stretch' }}></div>
                        <select
                            disabled
                            style={{ padding: '0.6rem', background: 'transparent', color: 'var(--text-secondary)', border: 'none', outline: 'none' }}
                        >
                            {(() => {
                                const itemData = prepItems.find(p => p.id === manualTask);
                                const metricVal = itemData ? itemData.metric : 'units';
                                return <option value={metricVal}>{metricVal}</option>;
                            })()}
                        </select>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: manualUrgent ? 'var(--danger)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={manualUrgent} onChange={(e) => setManualUrgent(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem' }} />
                        {t('PrepSchedule.urgent_q')}
                    </label>
                    <button className="btn-primary" onClick={handleAddManualTask} style={{ padding: '0.6rem 1.2rem', borderRadius: '8px' }}>{t('PrepSchedule.add_btn')}</button>
                </div>

                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
                ) : (
                    <>
                        {renderTaskTable(sortedMorningTasks, "Today (Today's Assigned Tasks)", t('PrepSchedule.no_tasks_today'), true)}
                        {renderTaskTable(sortedTomorrowTasks, `Tomorrow - ${tmwDateStr}`, `${t('PrepSchedule.no_tasks_tomorrow')}${tmwDateStr}`, false)}
                    </>
                )}
            </div>
        );
    };

    const handleSaveNightShift = async () => {
        setIsLoading(true);
        const tasksPayload = Object.keys(nightDrafts)
            .filter(id => nightDrafts[id].selected)
            .map(id => ({
                ingredientId: id,
                qty: parseFloat(nightDrafts[id].qty) || 0,
                userId: nightDrafts[id].userId || undefined,
                urgent: nightDrafts[id].urgent
            }));

        const dateObj = new Date(targetAssignDate);
        const tzDate = new Date(dateObj.getTime() + dateObj.getTimezoneOffset() * 60000);

        const res = await assignNightShiftTasks(tasksPayload, tzDate);
        if (res.success) {
            alert("Tasks assigned successfully!");
            await loadDataForTab('night');
        } else {
            alert("Error saving: " + res.error);
        }
        setIsLoading(false);
    };

    const handleNightDraftToggle = (id: string, isSelected: boolean) => {
        setNightDrafts(prev => ({ ...prev, [id]: { ...prev[id], selected: isSelected } }));
    };

    const handleNightDraftChange = (id: string, field: 'qty' | 'userId' | 'urgent', value: any) => {
        setNightDrafts(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    };

    const renderNightShift = () => {
        // Group by Category -> Parent Ingredient
        const grouped: Record<string, Record<string, any[]>> = {};
        prepItems.forEach(item => {
            const cat = item.category?.name || 'Uncategorized';
            const parent = item.parent?.name || 'Base Tasks';
            if (!grouped[cat]) grouped[cat] = {};
            if (!grouped[cat][parent]) grouped[cat][parent] = [];
            grouped[cat][parent].push(item);
        });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <p style={{ color: 'var(--text-primary)', margin: 0 }}>{t('PrepSchedule.select_eligible_tasks')}</p>
                        <input type="date" value={targetAssignDate} onChange={(e) => setTargetAssignDate(e.target.value)} style={{ padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150, 150, 150, 0.3)' }} />
                    </div>
                    <button onClick={handleSaveNightShift} className="btn-primary" style={{ padding: '0.6rem 1.2rem', borderRadius: '12px', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Check size={18} /> {t('PrepSchedule.save_and_assign')}
                    </button>
                </div>
                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading Tasks...</div>
                ) : (
                    <div className="glass-panel" style={{ overflowX: 'auto', padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_category')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_ingredient')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_task')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_quantity')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', minWidth: '150px' }}>{t('PrepSchedule.th_preparer')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>{t('PrepSchedule.th_urgent')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.keys(grouped).sort().map(catName => {
                                    const parents = grouped[catName];
                                    const catRows = Object.keys(parents).reduce((sum, p) => sum + parents[p].length, 0);
                                    let isFirstCatRow = true;

                                    return Object.keys(parents).sort().map(parentName => {
                                        const tasks = parents[parentName];
                                        const parRows = tasks.length;
                                        let isFirstParRow = true;

                                        return tasks.map(task => {
                                            const renderCat = isFirstCatRow;
                                            const renderPar = isFirstParRow;
                                            isFirstCatRow = false;
                                            isFirstParRow = false;

                                            const draft = nightDrafts[task.id] || { selected: false, qty: '', userId: '' };

                                            return (
                                                <tr key={task.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: draft.selected ? 'rgba(59, 130, 246, 0.05)' : 'transparent', transition: 'background 0.2s' }}>
                                                    {renderCat && <td rowSpan={catRows} style={{ padding: '1rem', verticalAlign: 'top', fontWeight: 'bold', borderRight: '1px solid rgba(255,255,255,0.05)' }}>{catName}</td>}
                                                    {renderPar && <td rowSpan={parRows} style={{ padding: '1rem', verticalAlign: 'top', color: 'var(--text-secondary)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>{parentName}</td>}
                                                    <td style={{ padding: '0.5rem 1rem' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer', margin: 0, padding: '0.5rem', borderRadius: '8px', transition: 'background 0.2s' }}>
                                                            <input type="checkbox" checked={draft.selected} onChange={(e) => handleNightDraftToggle(task.id, e.target.checked)} style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }} />
                                                            <span style={{ fontSize: '0.95rem' }}>{task.name}</span>
                                                        </label>
                                                    </td>
                                                    <td style={{ padding: '0.5rem 1rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <input type="number" step="0.01" min="0" placeholder="0" value={draft.qty} onChange={(e) => handleNightDraftChange(task.id, 'qty', e.target.value)} disabled={!draft.selected} style={{ width: '80px', padding: '0.5rem', borderRadius: '8px', background: draft.selected ? 'white' : 'rgba(255,255,255,0.05)', color: draft.selected ? 'black' : 'white', border: '1px solid rgba(255,255,255,0.2)' }} />
                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{task.metric}</span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.5rem 1rem' }}>
                                                        <select value={draft.userId} onChange={(e) => handleNightDraftChange(task.id, 'userId', e.target.value)} disabled={!draft.selected} style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', background: draft.selected ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.2)' }}>
                                                            <option value="">{t('PrepSchedule.any_cook')}</option>
                                                            {teamMembers.map(m => (
                                                                <option key={m.id} value={m.id}>{m.name}</option>
                                                            ))}
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '0.5rem 1rem', textAlign: 'center' }}>
                                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: draft.selected ? 'pointer' : 'not-allowed', color: draft.urgent ? 'var(--danger)' : 'var(--text-secondary)' }}>
                                                            <input type="checkbox" checked={draft.urgent} onChange={(e) => handleNightDraftChange(task.id, 'urgent', e.target.checked)} disabled={!draft.selected} style={{ width: '1.2rem', height: '1.2rem' }} />
                                                        </label>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    });
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const renderRecurringPrep = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('PrepSchedule.recurring_desc')}</p>
                <button className="btn-primary" onClick={() => setShowRecurringForm(!showRecurringForm)} style={{ padding: '0.6rem 1.2rem', borderRadius: '12px' }}>
                    {showRecurringForm ? 'Cancel' : t('PrepSchedule.new_recurring')}
                </button>
            </div>

            {showRecurringForm && (
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Prep Task</label>
                        <select value={newRecurringTask} onChange={(e) => setNewRecurringTask(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150,150,150,0.3)' }}>
                            <option value="">Select Task...</option>
                            {prepItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Day of Week</label>
                        <select value={newRecurringDay} onChange={(e) => setNewRecurringDay(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150,150,150,0.3)' }}>
                            <option value="0">Sunday</option>
                            <option value="1">Monday</option>
                            <option value="2">Tuesday</option>
                            <option value="3">Wednesday</option>
                            <option value="4">Thursday</option>
                            <option value="5">Friday</option>
                            <option value="6">Saturday</option>
                        </select>
                    </div>
                    <div style={{ flex: 1, minWidth: '120px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Amount</label>
                        <input type="number" step="0.01" min="0" value={newRecurringAmount} onChange={(e) => setNewRecurringAmount(e.target.value)} placeholder="0.0" style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150,150,150,0.3)' }} />
                    </div>
                    <button className="btn-primary" onClick={handleCreateRecurringRule} style={{ padding: '0.8rem 1.5rem', borderRadius: '8px', height: 'fit-content', background: 'linear-gradient(135deg, #a855f7, #6b21a8)' }}>
                        Save Rule
                    </button>
                </div>
            )}

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
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                                                <div style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', padding: '0.3rem 0.6rem', borderRadius: '8px', fontWeight: 'bold' }}>
                                                    {rule.amount} {rule.ingredient.metric || 'kg'}
                                                </div>
                                                <button onClick={() => handleRemoveRecurringRule(rule.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><Trash2 size={16} /></button>
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

    const handleAddTeamMember = async () => {
        const name = prompt("Enter kitchen worker's name:");
        if (!name) return;
        setIsLoading(true);
        await addTeamMember(name);
        setTeamMembers(await getTeamMembers());
        setIsLoading(false);
    };

    const handleRemoveTeamMember = async (id: string) => {
        if (!confirm("Remove this kitchen worker?")) return;
        setIsLoading(true);
        await removeTeamMember(id);
        setTeamMembers(await getTeamMembers());
        setIsLoading(false);
    };

    const [newTaskName, setNewTaskName] = useState('');
    const [newTaskCatId, setNewTaskCatId] = useState('');
    const [newTaskParentId, setNewTaskParentId] = useState('');

    const handleAddPrepTask = async () => {
        if (!newTaskName) return alert("Enter task name");
        if (!newTaskCatId) return alert("Select a Category");
        setIsLoading(true);
        await addPrepTaskItem(newTaskName, newTaskCatId, 'units', newTaskParentId || undefined);
        setPrepItems(await getPrepTaskItems());
        setNewTaskName('');
        setNewTaskCatId('');
        setNewTaskParentId('');
        setIsLoading(false);
    };

    const handleRemovePrepTask = async (id: string, uses: number) => {
        if (uses > 0) return alert("Cannot delete a task being used in recipes.");
        if (!confirm("Delete this prep task element?")) return;
        setIsLoading(true);
        await removePrepTaskItem(id);
        setPrepItems(await getPrepTaskItems());
        setIsLoading(false);
    };

    const renderTeamAndTasks = () => {
        const grouped: Record<string, Record<string, any[]>> = {};
        prepItems.forEach(item => {
            const cat = item.category?.name || 'Uncategorized';
            const parent = item.parent?.name || 'Base Tasks';
            if (!grouped[cat]) grouped[cat] = {};
            if (!grouped[cat][parent]) grouped[cat][parent] = [];
            grouped[cat][parent].push(item);
        });

        return (
            <div style={{ display: 'flex', gap: '2rem' }}>
                <div className="glass-panel" style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.8rem' }}><Users size={20} color="var(--accent-primary)" /> Kitchen Workers</h3>
                        <button onClick={handleAddTeamMember} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}>+ Add Worker</button>
                    </div>
                    {teamMembers.map(m => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.8rem 1rem', borderRadius: '8px' }}>
                            <span>{m.name}</span>
                            <button onClick={() => handleRemoveTeamMember(m.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}><Trash2 size={16} /></button>
                        </div>
                    ))}
                </div>

                <div className="glass-panel" style={{ flex: 2, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.8rem' }}><Layers size={20} color="#a855f7" /> Eligible Prep Tasks</h3>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '12px', alignItems: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <input type="text" placeholder="Task Name (e.g. Cocinar Camote)" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ flex: 2, padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150,150,150,0.3)' }} />
                        <select value={newTaskCatId} onChange={e => setNewTaskCatId(e.target.value)} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150,150,150,0.3)' }}>
                            <option value="">-- Category --</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select value={newTaskParentId} onChange={e => setNewTaskParentId(e.target.value)} style={{ flex: 1, padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(150,150,150,0.3)' }}>
                            <option value="">-- Link to Base Ingredient --</option>
                            {baseIngredients.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        <button onClick={handleAddPrepTask} className="btn-primary" style={{ padding: '0.6rem 1.2rem', background: 'linear-gradient(135deg, #a855f7, #6b21a8)' }}>+ Add</button>
                    </div>

                    <div className="glass-panel" style={{ overflowX: 'auto', padding: 0, marginTop: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_category')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Base / {t('PrepSchedule.th_ingredient')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{t('PrepSchedule.th_task')} / Metric</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.keys(grouped).sort().map(catName => {
                                    const parents = grouped[catName];
                                    const catRows = Object.keys(parents).reduce((sum, p) => sum + parents[p].length, 0);
                                    let isFirstCatRow = true;

                                    return Object.keys(parents).sort().map(parentName => {
                                        const tasks = parents[parentName];
                                        const parRows = tasks.length;
                                        let isFirstParRow = true;

                                        return tasks.map(t => {
                                            const renderCat = isFirstCatRow;
                                            const renderPar = isFirstParRow;
                                            isFirstCatRow = false;
                                            isFirstParRow = false;

                                            return (
                                                <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}>
                                                    {renderCat && <td rowSpan={catRows} style={{ padding: '1rem', verticalAlign: 'top', fontWeight: 'bold', borderRight: '1px solid rgba(255,255,255,0.05)' }}>{catName}</td>}
                                                    {renderPar && <td rowSpan={parRows} style={{ padding: '1rem', verticalAlign: 'top', color: 'var(--text-secondary)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>{parentName}</td>}
                                                    <td style={{ padding: '0.8rem 1rem' }}>
                                                        <span style={{ fontSize: '0.95rem' }}>{t.name}</span>
                                                        <span style={{ marginLeft: '0.8rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>({t.metric})</span>
                                                    </td>
                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                        <button onClick={() => handleRemovePrepTask(t.id, t._count.usedInPreps)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: t._count.usedInPreps > 0 ? 'var(--text-secondary)' : 'var(--danger)' }} title={t._count.usedInPreps > 0 ? "Cannot delete: currently used." : "Delete task"}><Trash2 size={16} /></button>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    });
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

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
                        {t('PrepSchedule.tab_logs')}
                    </button>
                    <button
                        onClick={() => setActiveTab('team')}
                        style={{ flex: 1, padding: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'team' ? '2px solid var(--accent-secondary)' : '2px solid transparent', color: activeTab === 'team' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'team' ? 600 : 400, fontSize: '1.1rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <Users size={20} color={activeTab === 'team' ? 'var(--accent-secondary)' : 'inherit'} />
                        {t('PrepSchedule.tab_team')}
                    </button>
                </div>

                {/* Tab Output Section */}
                <div style={{ padding: '2rem' }}>
                    {activeTab === 'morning' && renderMorningPrep()}
                    {activeTab === 'night' && renderNightShift()}
                    {activeTab === 'recurring' && renderRecurringPrep()}
                    {activeTab === 'completed' && renderCompletedLogs()}
                    {activeTab === 'team' && renderTeamAndTasks()}
                </div>

            </div>

            {/* DELETE MODAL */}
            {deleteTaskCandidate && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
                    zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
                }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '2rem', borderRadius: '12px', width: '400px', maxWidth: '100%', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>{t('Nav.sales') === 'Ventas' ? 'Borrar Tarea' : 'Delete Task'}</h3>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{deleteTaskCandidate.ingredientName}</p>

                        {!deleteTaskReason ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <button onClick={() => setDeleteTaskReason('NOT_NECESSARY')} className="btn-secondary" style={{ padding: '0.8rem', width: '100%', justifyContent: 'center' }}>
                                    {t('Nav.sales') === 'Ventas' ? 'No Necesario' : 'Not Necessary'}
                                </button>
                                {isTodayTasks && (
                                    <button onClick={() => setDeleteTaskReason('MISTAKE')} className="btn-secondary" style={{ padding: '0.8rem', width: '100%', justifyContent: 'center', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                                        {t('Nav.sales') === 'Ventas' ? 'Asignado por Error' : 'Assigned by Mistake'}
                                    </button>
                                )}
                                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                                    <button onClick={() => setDeleteTaskCandidate(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            </div>
                        ) : deleteTaskReason === 'MISTAKE' ? (
                            <div>
                                <p style={{ marginBottom: '1.5rem', color: 'var(--danger)' }}>{t('Nav.sales') === 'Ventas' ? '¿Estás seguro de que deseas eliminar esta tarea permanentemente?' : 'Are you sure you want to permanently delete this task?'}</p>
                                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setDeleteTaskReason(null)} className="btn-secondary">Back</button>
                                    <button onClick={handleConfirmDeleteComplete} className="btn-primary" style={{ background: 'var(--danger)' }}>Delete</button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>{t('Nav.sales') === 'Ventas' ? 'Autorizado Por:' : 'Authorized By:'}</label>
                                <select value={deleteTaskCook} onChange={(e) => setDeleteTaskCook(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                                    <option value="">{t('PrepSchedule.select_user')}</option>
                                    {prepUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setDeleteTaskReason(null)} className="btn-secondary">Back</button>
                                    <button onClick={handleConfirmDeleteComplete} className="btn-primary" disabled={!deleteTaskCook}>Confirm</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
