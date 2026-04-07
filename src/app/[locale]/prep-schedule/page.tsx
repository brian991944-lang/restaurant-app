'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Calendar, User, ChefHat, Check, Clock, AlertCircle, Repeat, MoonStar, Layers, Users, Trash2, Pencil, Plus, Settings, Snowflake, BookOpen, Search, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getDigitalRecipes } from '@/app/actions/recetario';
import { getDailyPrepTasks, completePrepTask, PrepTask, undoPrepTask, getCompletedPrepLogs, createManualPrepAssignment, deletePrepAssignment, getDefrostingPresets, getAirTightRules, createOrUpdatePrepRule, deleteAirTightRule, applyRulesToCategory } from '@/app/actions/prepSchedule';
import { getAssignmentsForDate, assignNightShiftTasks } from '@/app/actions/nightShift';
import { getRecurringRules, createRecurringRule, deleteRecurringRule } from '@/app/actions/recurringPrep';
import { getPrepUsers } from '@/app/actions/users';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { getTeamMembers, addTeamMember, removeTeamMember, getPrepTaskItems, addPrepTaskItem, removePrepTaskItem, getBaseIngredients, editPrepTaskItem } from '@/app/actions/teamTasks';
import { getCategories } from '@/app/actions/inventory';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import ManageOptionsModal from '@/components/modals/ManageOptionsModal';
import { useAdmin } from '@/components/AdminContext';
import React, { Component, ErrorInfo, ReactNode } from 'react';

class MatrixErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error("Matrix crash:", error, errorInfo); }
    render() {
        if (this.state.hasError) return <div style={{ color: 'red', padding: '1rem', background: '#ffe4e6', borderRadius: '8px', border: '1px solid #fecdd3' }}>Fallo en la Carga de Matriz. Data Incompleta. {this.props.children}</div>;
        return this.props.children;
    }
}

export default function PrepSchedulePage() {
    const t = useTranslations();
    const locale = useLocale();
    const { isAdmin } = useAdmin();

    // Tab State
    const [activeTab, setActiveTab] = useState<'morning' | 'night' | 'recurring' | 'airtight' | 'completed' | 'team' | 'defrosting'>('morning');
    const [morningDate, setMorningDate] = useState<Date>(new Date());

    // Data States
    const [morningTasks, setMorningTasks] = useState<PrepTask[]>([]);
    const [tomorrowTasks, setTomorrowTasks] = useState<PrepTask[]>([]);
    const [nightAssignments, setNightAssignments] = useState<any[]>([]);
    const [recurringRules, setRecurringRules] = useState<any[]>([]);
    const [airTightRules, setAirTightRules] = useState<any[]>([]);
    const [completedLogs, setCompletedLogs] = useState<any[]>([]);
    const [prepUsers, setPrepUsers] = useState<any[]>([]);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [prepItems, setPrepItems] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [digitalRecipes, setDigitalRecipes] = useState<any[]>([]);

    // Air-Tight Creation State
    const [showAirTightForm, setShowAirTightForm] = useState(false);
    const [newAirTightTask, setNewAirTightTask] = useState('');
    const [newAirTightType, setNewAirTightType] = useState('REGULAR');
    const [newAirTightProdDay, setNewAirTightProdDay] = useState('0');
    const [newAirTightCoverageDays, setNewAirTightCoverageDays] = useState<string[]>([]);
    const [newAirTightEmergencyDays, setNewAirTightEmergencyDays] = useState('3');
    const [newAirTightEmergencyThreshold, setNewAirTightEmergencyThreshold] = useState('1.5');

    // Defrosting State
    const [defrostTasks, setDefrostTasks] = useState<any[]>([]);
    const [defrostSubTab, setDefrostSubTab] = useState<'cocinero1' | 'cocinero2'>('cocinero1');
    const [defrostQuantities, setDefrostQuantities] = useState<Record<string, string>>({});
    const [globalDefrostCook, setGlobalDefrostCook] = useState<string>('');

    // UI States
    const [isLoading, setIsLoading] = useState(true);
    const [actuals, setActuals] = useState<Record<string, string>>({});
    const [assignedCooks, setAssignedCooks] = useState<Record<string, string>>({});
    const [completing, setCompleting] = useState<string | null>(null);

    // Delete Modal State
    const [deleteTaskCandidate, setDeleteTaskCandidate] = useState<PrepTask | null>(null);
    const [deleteTaskReason, setDeleteTaskReason] = useState<'NOT_NECESSARY' | 'MISTAKE' | null>(null);
    const [deleteTaskCook, setDeleteTaskCook] = useState<string>('');
    const [viewingRecipeId, setViewingRecipeId] = useState<string | null>(null);
    const [isTodayTasks, setIsTodayTasks] = useState(false);

    // Night Shift form state
    const [nightDrafts, setNightDrafts] = useState<Record<string, { selected: boolean, qty: string, userId: string, urgent: boolean }>>({});
    const [baseIngredients, setBaseIngredients] = useState<any[]>([]);

    const [targetAssignDate, setTargetAssignDate] = useState<string>(() => {
        const d = new Date();
        d.setHours(d.getHours() - 5);
        return d.toISOString().split('T')[0];
    });

    const displayMetric = (m: string | null | undefined) => {
        if (!m) return '';
        const low = m.toLowerCase();
        if (low === 'units' || low === 'unit') return locale === 'es' ? 'Unidades' : 'Units';
        if (low === 'pieces' || low === 'piece') return locale === 'es' ? 'Piezas' : 'Pieces';
        if (low === 'pounds' || low === 'lb' || low === 'lbs') return locale === 'es' ? 'Lbs' : m;
        if (low === 'liters' || low === 'liter' || low === 'l') return locale === 'es' ? 'L' : m;
        if (low === 'grams' || low === 'gram' || low === 'g') return locale === 'es' ? 'g' : m;
        return m;
    };

    const [tmwDateStr, setTmwDateStr] = useState<string>(() => {
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
    const [newRecurringBase, setNewRecurringBase] = useState('');
    const [newRecurringDay, setNewRecurringDay] = useState('0');
    const [newRecurringAmount, setNewRecurringAmount] = useState('');

    const handleCreateRecurringRule = async () => {
        if (!newRecurringTask || !newRecurringAmount || !newRecurringBase) return;
        setIsLoading(true);
        await createRecurringRule(newRecurringTask, parseInt(newRecurringDay), parseFloat(newRecurringAmount), newRecurringBase);
        setRecurringRules(await getRecurringRules());
        setShowRecurringForm(false);
        setNewRecurringTask('');
        setNewRecurringBase('');
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

    const loadDataForTab = async (tab: 'morning' | 'night' | 'recurring' | 'completed' | 'team' | 'defrosting') => {
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

            const [todayData, tomorrowData, items, recipes] = await Promise.all([
                getDailyPrepTasks(todayDate),
                getDailyPrepTasks(tmwDate),
                getPrepTaskItems(),
                getDigitalRecipes()
            ]);
            setMorningTasks(todayData);
            setTomorrowTasks(tomorrowData);
            setPrepItems(items);
            setDigitalRecipes(recipes);
        } else if (tab === 'night') {
            const tzDate = new Date(`${targetAssignDate}T12:00:00-05:00`);
            const [assignments, members, tasks] = await Promise.all([getAssignmentsForDate(tzDate), getTeamMembers(), getPrepTaskItems()]);
            setNightAssignments(assignments);
            setTeamMembers(members);
            setPrepItems(tasks);
        } else if (tab === 'recurring') {
            const [rules, bases] = await Promise.all([getAirTightRules(), getBaseIngredients()]);
            setAirTightRules(rules);
            setBaseIngredients(bases);
        } else if (tab === 'completed') {
            const data = await getCompletedPrepLogs();
            setCompletedLogs(data);
        } else if (tab === 'team') {
            const [members, tasks, cats, bases, recipes] = await Promise.all([getTeamMembers(), getPrepTaskItems(), getCategories(), getBaseIngredients(), getDigitalRecipes()]);
            setTeamMembers(members);
            setPrepItems(tasks);
            setCategories(cats);
            setBaseIngredients(bases);
            setDigitalRecipes(recipes);
        } else if (tab === 'defrosting') {
            try {
                const [presets, members, logs, rules] = await Promise.all([
                    getDefrostingPresets([
                        'Descongelar Calamar Porcion', 'Descongelar Camaron Porcion', 'Descongelar Camaron Hervido',
                        'Descongelar Pescado Jalea', 'Descongelar Pescado Ceviche', 'Descongelar Pescado Macho',
                        'Descongelar Patas de Pulpo Anticuchadas', 'Descongelar Salmon Filete', 'Descongelar Seafood Mix Porcion',
                        'Descongelar Pollo Para Causa', 'Descongelar Pollo Para Chaufa', 'Descongelar Croquetas',
                        'Descongelar Chicharron Porciones', 'Bisteck - Porcionar', 'Lomo Chaufa - Cortar y Porcionar', 'Lomo - Cortar y Porcionar'
                    ]),
                    getTeamMembers(),
                    getCompletedPrepLogs(),
                    getRecurringRules()
                ]);
                setDefrostTasks(presets);
                setTeamMembers(members);
                setCompletedLogs(logs);
                setRecurringRules(rules);
            } catch (err) {
                console.error("Tab data loading failed:", err);
                alert("Could not load Defrosting Station data fully. Please try refreshing.");
            }
        } else if (tab === 'airtight') {
            const [rules, tasks] = await Promise.all([getAirTightRules(), getPrepTaskItems()]);
            setAirTightRules(rules);
            setPrepItems(tasks);
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
            const cookName = prepUsers.find(u => u.id === cookId)?.name || 'Any Cook';
            setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: actual, completedBy: cookName } : t));
            setTomorrowTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: actual, completedBy: cookName } : t));
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
                if (isTodayTasks) setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: 0, completedBy: cookName } : t));
                else setTomorrowTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: true, actualAmount: 0, completedBy: cookName } : t));
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
            setMorningTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: false, actualAmount: null, completedBy: undefined } : t));
            setTomorrowTasks(prev => prev.map(t => t.ingredientId === task.ingredientId ? { ...t, completed: false, actualAmount: null, completedBy: undefined } : t));
        }
        setCompleting(null);
    };

    const filteredMorningTasks = morningTasks.filter(t => {
        if (!t.category) return true;
        const normalized = t.category.trim().toLowerCase();
        return !normalized.includes('descongelar');
    });
    const filteredTomorrowTasks = tomorrowTasks.filter(t => {
        if (!t.category) return true;
        const normalized = t.category.trim().toLowerCase();
        return !normalized.includes('descongelar');
    });

    const sortedMorningTasks = [...filteredMorningTasks].sort((a, b) => Number(a.completed) - Number(b.completed));
    const sortedTomorrowTasks = [...filteredTomorrowTasks].sort((a, b) => Number(a.completed) - Number(b.completed));

    const renderTaskTable = (tasksObj: PrepTask[], title: string, emptyMessage: string, isTodayList: boolean) => {
        if (tasksObj.length === 0) return (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                <Layers size={30} style={{ opacity: 0.3, margin: '0 auto 1rem auto' }} />
                <p>{emptyMessage}</p>
            </div>
        );

        const sortedTasks = [...tasksObj].sort((a, b) => {
            if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
            if (a.isUrgent && !b.isUrgent) return -1;
            if (!a.isUrgent && b.isUrgent) return 1;
            return a.ingredientName.localeCompare(b.ingredientName);
        });

        return (
            <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontWeight: 'bold' }}>{title}</h3>
                <div className="glass-panel table-wrapper-responsive" style={{ overflowX: 'auto', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '100%' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                <th className="hide-on-tablet" style={{ padding: '1rem', borderBottom: '1px solid var(--border)', width: '60px' }}></th>
                                <th className="hide-on-tablet" style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>{t('PrepSchedule.th_category')}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>{t('PrepSchedule.th_task')}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>{t('Nav.sales') === 'Ventas' ? 'Cantidad a Preparar' : 'Target'}</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center', minWidth: '120px' }}>{t('Nav.sales') === 'Ventas' ? 'Cantidad Preparada' : 'Actual'}</th>
                                <th className="hide-on-tablet" style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>Unidad de Medida</th>
                                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', minWidth: '150px' }}>Preparador</th>
                                <th className="status-column-responsive" style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedTasks.map(task => {
                                const catName = task.category || 'Uncategorized';
                                const parentName = task.parentName || 'Base Tasks';

                                const isDone = task.completed;
                                const isProcessing = completing === task.ingredientId;

                                let recommendedTarget = 0;
                                if (task.airTightSuggestedAmount !== undefined && task.airTightSuggestedAmount > 0) {
                                    recommendedTarget = task.airTightSuggestedAmount;
                                } else if (task.hasRecurring) {
                                    recommendedTarget = task.recurringAmount;
                                } else if (task.hasNightShift) {
                                    recommendedTarget = task.assignedAmount;
                                } else {
                                    recommendedTarget = task.assignedAmount || 0; // Manual tasks
                                }

                                const rowBackground = isDone ? 'rgba(0,0,0,0.2)' : (
                                    task.isEmergency ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.05)'
                                );

                                return (
                                    <tr key={task.ingredientId} style={{ borderBottom: '1px solid var(--border)', background: rowBackground, opacity: isDone ? 0.6 : 1, transition: 'background 0.2s' }}>
                                        <td className="hide-on-tablet" style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                            {task.hasNightShift ? (
                                                <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                                    <MoonStar size={18} color="var(--warning)" />
                                                </div>
                                            ) : task.hasRecurring ? (
                                                <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: '0.6rem', borderRadius: '8px', display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                                    <Calendar size={18} color="#a855f7" />
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="hide-on-tablet" style={{ padding: '1rem', verticalAlign: 'middle', fontWeight: 'bold', borderRight: '1px solid var(--border)' }}>{catName}</td>
                                        <td style={{ padding: '0.8rem 1rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    {task.digitalRecipeId && (
                                                        <button
                                                            onClick={() => setViewingRecipeId(task.digitalRecipeId!)}
                                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                                                            title={task.digitalRecipeName || 'Ver Receta'}
                                                        >
                                                            <BookOpen size={16} color="var(--accent-primary)" />
                                                        </button>
                                                    )}
                                                    <span style={{ fontSize: '0.95rem', textDecoration: isDone ? 'line-through' : 'none', color: task.digitalRecipeId ? 'var(--accent-primary)' : 'inherit', fontWeight: 500 }}>{task.ingredientName}</span>
                                                    {task.isUrgent && !task.isEmergency && <span style={{ fontSize: '1.1rem' }} title="Urgent Task">🚨</span>}
                                                </div>
                                                {task.isEmergency && (
                                                    <div style={{ fontSize: '0.85rem', color: '#ff4d4f', fontWeight: 'bold', background: 'rgba(239, 68, 68, 0.15)', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.3)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', alignSelf: 'flex-start' }}>
                                                        <span style={{ fontSize: '1rem' }}>🚨</span> EMERGENCIA: Stock Crítico
                                                    </div>
                                                )}
                                                {task.suggestedBaseIngredientName && task.suggestedBaseAmount !== null && !task.isEmergency && (
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 500, background: 'rgba(59, 130, 246, 0.05)', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                                        Sugerencia: Procesar {task.suggestedBaseAmount} kg de {task.suggestedBaseIngredientName} para {task.ingredientName}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                            <span style={{ fontSize: '1rem', fontWeight: 'bold', color: task.isEmergency ? '#ff4d4f' : 'var(--accent-primary)' }}>{recommendedTarget}</span>
                                            <span className="show-on-tablet" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '0.4rem', fontWeight: 'normal' }}>{displayMetric(task.metric)}</span>
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                            {isDone ? (
                                                <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--success)' }}>{task.actualAmount}</span>
                                            ) : (
                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                                    <input type="number" step="0.01" min="0" placeholder={recommendedTarget.toString()} value={actuals[task.ingredientId] || ''} onChange={(e) => handleActualChange(task.ingredientId, e.target.value)} style={{ width: '60px', padding: '0.3rem', border: '1px solid var(--border)', borderRadius: '8px', outline: 'none', background: 'white', color: 'black', textAlign: 'center', fontWeight: 'bold' }} />
                                                    <span className="show-on-tablet" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{displayMetric(task.metric)}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="hide-on-tablet" style={{ padding: '0.8rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.95rem', fontWeight: 500 }}>
                                            {displayMetric(task.metric)}
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem' }}>
                                            {isDone ? (
                                                <span style={{ color: 'var(--text-secondary)', fontWeight: 'bold' }}>{task.completedBy || 'Any Cook'}</span>
                                            ) : (
                                                <select className="prep-dropdown-responsive" value={assignedCooks[task.ingredientId] || ''} onChange={(e) => setAssignedCooks(prev => ({ ...prev, [task.ingredientId]: e.target.value }))} style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                                                    <option value="">{t('PrepSchedule.select_user') || 'Select...'}</option>
                                                    {prepUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                                </select>
                                            )}
                                        </td>
                                        <td className="status-column-responsive" style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                            {isProcessing ? (
                                                <div className="spinner" style={{ width: '20px', height: '20px', margin: '0 auto', borderTopColor: 'var(--accent-primary)' }} />
                                            ) : isDone ? (
                                                <button onClick={() => handleUndoTask(task)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                                                    <span className="hide-on-tablet">{t('Nav.sales') === 'Ventas' ? 'Deshacer' : 'Undo'}</span>
                                                    <span className="show-on-tablet"><X size={16} /></span>
                                                </button>
                                            ) : (
                                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                                    <button onClick={() => handleCompleteTask(task)} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <span className="hide-on-tablet">{t('Nav.sales') === 'Ventas' ? 'Completar' : 'Complete'}</span>
                                                        <span className="show-on-tablet"><Check size={16} /></span>
                                                    </button>
                                                    <button onClick={() => {
                                                        setIsTodayTasks(isTodayList);
                                                        setDeleteTaskCandidate(task);
                                                    }} className="btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', color: 'white', background: 'var(--danger)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <span className="hide-on-tablet">{t('Nav.sales') === 'Ventas' ? 'Borrar' : 'Delete'}</span>
                                                        <span className="show-on-tablet"><Trash2 size={16} /></span>
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                        </tr>
                                );
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
                <div style={{ display: 'flex', gap: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
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
                            <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.pending', { count: filteredMorningTasks.filter(t => !t.completed).length + filteredTomorrowTasks.filter(t => !t.completed).length })}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Check size={18} color="var(--success)" />
                            <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.completed', { count: filteredMorningTasks.filter(t => t.completed).length + filteredTomorrowTasks.filter(t => t.completed).length })}</span>
                        </div>
                    </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: '200px', zIndex: 10 }}>
                        <SearchableSelect
                            value={manualTask}
                            onChange={(val) => setManualTask(val)}
                            options={[
                                { value: '', label: t('PrepSchedule.add_manual_today') },
                                ...prepItems
                                    .filter(item => !(item.category?.name || '').toLowerCase().includes('descongelar'))
                                    .map(item => ({
                                        value: item.id,
                                        label: item.name,
                                        category: item.category?.name || 'Uncategorized'
                                    }))
                            ]}
                            placeholder={t('PrepSchedule.add_manual_today')}
                        />
                    </div>
                    <div style={{ flex: 1, minWidth: '160px', display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                        <input type="number" step="0.01" min="0" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder={t('Nav.sales') === 'Ventas' ? 'Cantidad' : 'Cantidad'} style={{ flex: 1, width: '80px', padding: '0.6rem', background: 'transparent', color: 'var(--text-primary)', border: 'none', outline: 'none' }} />
                        <div style={{ borderLeft: '1px solid var(--border)', alignSelf: 'stretch' }}></div>
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
                        {renderTaskTable(sortedMorningTasks, t('Nav.sales') === 'Ventas' ? "Hoy (Tareas Asignadas para Hoy)" : "Today (Today's Assigned Tasks)", t('PrepSchedule.no_tasks_today'), true)}
                        {renderTaskTable(sortedTomorrowTasks, `${t('Nav.sales') === 'Ventas' ? 'Mañana' : 'Tomorrow'} - ${tmwDateStr}`, `${t('PrepSchedule.no_tasks_tomorrow')}${tmwDateStr}`, false)}
                    </>
                )}
            </div>
        );
    };

    const handleSaveNightShift = async () => {
        setIsLoading(true);
        const tzDate = new Date(`${targetAssignDate}T12:00:00-05:00`);
        const calculatedTasks = await getDailyPrepTasks(tzDate);

        const tasksPayload = Object.keys(nightDrafts)
            .filter(id => nightDrafts[id].selected)
            .map(id => {
                const cal = calculatedTasks.find(t => t.ingredientId === id);
                let qty = 0;
                if (cal) {
                    if (cal.airTightSuggestedAmount !== undefined && cal.airTightSuggestedAmount > 0) {
                        qty = cal.airTightSuggestedAmount;
                    } else if (cal.hasRecurring && cal.recurringAmount !== undefined) {
                        qty = cal.recurringAmount;
                    }
                }

                return {
                    ingredientId: id,
                    qty: qty,
                    userId: nightDrafts[id].userId || undefined,
                    urgent: nightDrafts[id].urgent
                };
            });



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
            if (cat.toLowerCase().includes('descongelar')) return;
            const parent = item.parent?.name || 'Base Tasks';
            if (!grouped[cat]) grouped[cat] = {};
            if (!grouped[cat][parent]) grouped[cat][parent] = [];
            grouped[cat][parent].push(item);
        });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <p style={{ color: 'var(--text-primary)', margin: 0, fontWeight: 'bold' }}>
                            {(() => {
                                const isEs = t('Nav.sales') === 'Ventas';
                                const d = new Date(`${targetAssignDate}T12:00:00-05:00`);
                                const estNowStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                                const todayDate = new Date(`${estNowStr}T12:00:00-05:00`);
                                const diffDays = Math.round((d.getTime() - todayDate.getTime()) / (1000 * 3600 * 24));
                                if (diffDays === 0) return isEs ? 'Hoy' : 'Today';
                                if (diffDays === 1) return isEs ? 'Mañana' : 'Tomorrow';
                                return d.toLocaleDateString(isEs ? 'es-ES' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                            })()}
                        </p>
                        <input type="date" value={targetAssignDate} onChange={(e) => setTargetAssignDate(e.target.value)} style={{ padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                    </div>
                    <button onClick={handleSaveNightShift} className="btn-primary" style={{ padding: '0.6rem 1.2rem', borderRadius: '12px', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Check size={18} /> {t('PrepSchedule.save_and_assign')}
                    </button>
                </div>
                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading Tasks...</div>
                ) : (
                    <div className="glass-panel table-wrapper-responsive" style={{ overflowX: 'auto', padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '100%' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    <th className="hide-on-tablet" style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>{t('PrepSchedule.th_category')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>{t('PrepSchedule.th_task')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', minWidth: '150px' }}>{t('PrepSchedule.th_preparer')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>{t('PrepSchedule.th_urgent')}</th>
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
                                        return tasks.map(task => {
                                            const draft = nightDrafts[task.id] || { selected: false, qty: '', userId: '' };

                                            return (
                                                <tr key={task.id} style={{ borderBottom: '1px solid var(--border)', background: draft.selected ? 'rgba(59, 130, 246, 0.05)' : 'transparent', transition: 'background 0.2s' }}>
                                                    <td className="hide-on-tablet" style={{ padding: '1rem', verticalAlign: 'middle', fontWeight: 'bold', borderRight: '1px solid var(--border)' }}>{catName}</td>
                                                    <td style={{ padding: '0.5rem 1rem' }}>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer', margin: 0, padding: '0.5rem', borderRadius: '8px', transition: 'background 0.2s' }}>
                                                            <input type="checkbox" checked={draft.selected} onChange={(e) => handleNightDraftToggle(task.id, e.target.checked)} style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }} />
                                                            <span style={{ fontSize: '0.95rem' }}>{task.name}</span>
                                                        </label>
                                                    </td>

                                                    <td style={{ padding: '0.5rem 1rem' }}>
                                                        <select className="prep-dropdown-responsive" value={draft.userId} onChange={(e) => handleNightDraftChange(task.id, 'userId', e.target.value)} disabled={!draft.selected} style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', background: draft.selected ? '#e6f2ff' : 'rgba(255,255,255,0.05)', color: draft.selected ? '#000080' : 'white', border: '1px solid var(--border)' }}>
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

    const renderDefrostingStation = () => {
        const cocinero1Tasks = ['Descongelar Calamar Porcion', 'Descongelar Camaron Porcion', 'Descongelar Camaron Hervido', 'Descongelar Pescado Jalea', 'Descongelar Pescado Ceviche', 'Descongelar Pescado Macho', 'Descongelar Patas de Pulpo Anticuchadas', 'Descongelar Salmon Filete', 'Descongelar Seafood Mix Porcion'];
        const cocinero2Tasks = ['Descongelar Pollo Para Causa', 'Descongelar Pollo Para Chaufa', 'Descongelar Croquetas', 'Descongelar Chicharron Porciones', 'Bisteck - Porcionar', 'Lomo Chaufa - Cortar y Porcionar', 'Lomo - Cortar y Porcionar'];

        const activePresetNames = defrostSubTab === 'cocinero1' ? cocinero1Tasks : cocinero2Tasks;

        // Filter out completed tasks from today
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

        const handleCompleteDefrost = async (ing: any) => {
            const qtyStr = defrostQuantities[ing.id];
            const userId = globalDefrostCook;
            if (!qtyStr || !userId) {
                alert(t('Nav.sales') === 'Ventas' ? "Seleccione un preparador y cantidad." : "Select a preparer and quantity.");
                return;
            }

            setCompleting(ing.id);
            const res = await completePrepTask(ing.id, parseFloat(qtyStr), userId);

            if (res.success) {
                const logs = await getCompletedPrepLogs();
                setCompletedLogs(logs);
                setDefrostQuantities(prev => ({ ...prev, [ing.id]: '' }));
            } else {
                alert("Error completando la tarea.");
            }
            setCompleting(null);
        };

        const handleUndoDefrost = async (ing: any, logs: any[]) => {
            if (!confirm('¿Estás seguro de que deseas revertir esta tarea? El inventario se ajustará automáticamente.')) return;
            setCompleting(ing.id);

            let successCount = 0;
            for (const log of logs) {
                const res = await undoPrepTask(ing.id, log.actualAmount, log.id);
                if (res?.success) successCount++;
            }

            if (successCount > 0) {
                const freshLogs = await getCompletedPrepLogs();
                setCompletedLogs(freshLogs);
            } else {
                alert('Error al deshacer la tarea.');
            }
            setCompleting(null);
        };

        let pendingCount = 0;
        let completedCount = 0;

        activePresetNames.forEach(taskName => {
            const ing = defrostTasks.find(t => t.name === taskName);
            if (!ing) return;
            const isCompletedToday = completedLogs.some(log => {
                const logEstStr = new Date(log.completedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                return log.ingredientName === taskName && logEstStr === todayStr;
            });
            if (isCompletedToday) completedCount++;
            else pendingCount++;
        });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                    <div style={{ display: 'flex' }}>
                        <button
                            onClick={() => setDefrostSubTab('cocinero1')}
                            style={{ padding: '0.8rem 1.5rem', background: 'transparent', border: 'none', borderBottom: defrostSubTab === 'cocinero1' ? '2px solid #3b82f6' : '2px solid transparent', color: defrostSubTab === 'cocinero1' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: defrostSubTab === 'cocinero1' ? 'bold' : 'normal', cursor: 'pointer', fontSize: '1.05rem', transition: '0.2s' }}>
                            Cocinero 1 (Seafood)
                        </button>
                        <button
                            onClick={() => setDefrostSubTab('cocinero2')}
                            style={{ padding: '0.8rem 1.5rem', background: 'transparent', border: 'none', borderBottom: defrostSubTab === 'cocinero2' ? '2px solid #ef4444' : '2px solid transparent', color: defrostSubTab === 'cocinero2' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: defrostSubTab === 'cocinero2' ? 'bold' : 'normal', cursor: 'pointer', fontSize: '1.05rem', transition: '0.2s' }}>
                            Cocinero 2 (Pollo/Carnes)
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                        <select
                            value={globalDefrostCook}
                            onChange={(e) => setGlobalDefrostCook(e.target.value)}
                            style={{ padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                            <option value="">Seleccionar Preparador...</option>
                            {teamMembers.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Clock size={18} color="var(--warning)" />
                            <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.pending', { count: pendingCount })}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Check size={18} color="var(--success)" />
                            <span style={{ color: 'var(--text-secondary)' }}>{t('PrepSchedule.completed', { count: completedCount })}</span>
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Cargando Estación...</div>
                ) : (
                    <div className="glass-panel" style={{ overflowX: 'auto', padding: 0 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>Tarea de Descongelado</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>Sugerido</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>Cantidad</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activePresetNames.map(taskName => {
                                    const ing = defrostTasks.find(t => t.name === taskName);

                                    if (!ing) {
                                        return (
                                            <tr key={taskName} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '1rem', color: 'var(--danger)' }}>{taskName} (No encontrado en Base de Datos)</td>
                                                <td colSpan={3}></td>
                                            </tr>
                                        );
                                    }

                                    // Check if completed today by inspecting logs
                                    const completedLogsToday = completedLogs.filter(log => {
                                        const logEstStr = new Date(log.completedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                                        return log.ingredientName === taskName && logEstStr === todayStr;
                                    });

                                    const isCompletedToday = completedLogsToday.length > 0;

                                    const todayIndex = new Date().getDay();
                                    // Retrieve the suggestion directly from the DB recurring rule for today
                                    const ruleForToday = recurringRules.find(r => r.ingredientId === ing.id && r.dayOfWeek === todayIndex);
                                    const suggested = ruleForToday ? ruleForToday.amount : 0;

                                    if (isCompletedToday) {
                                        const totalQty = completedLogsToday.reduce((sum, log) => sum + log.actualAmount, 0);
                                        const preparers = Array.from(new Set(completedLogsToday.map(log => log.completedBy))).join(', ');
                                        return (
                                            <tr key={taskName} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(16, 185, 129, 0.05)' }}>
                                                <td style={{ padding: '1rem', textDecoration: 'line-through', color: 'var(--text-secondary)' }}>{taskName}</td>
                                                <td colSpan={2} style={{ padding: '1rem', color: 'var(--success)', fontWeight: 'bold' }}>
                                                    ✅ Completado ({totalQty} {displayMetric(ing.metric)}) - Por: {preparers}
                                                </td>
                                                <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                    <button
                                                        disabled={completing === ing.id}
                                                        onClick={() => handleUndoDefrost(ing, completedLogsToday)}
                                                        className="btn-secondary"
                                                        style={{ padding: '0.4rem 0.8rem', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                                                        {completing === ing.id ? 'Revertiendo...' : 'Deshacer'}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    }

                                    return (
                                        <tr key={taskName} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                                            <td style={{ padding: '1rem', fontWeight: 500 }}>{taskName}</td>
                                            <td style={{ padding: '1rem' }}>
                                                <button
                                                    onClick={() => setDefrostQuantities(prev => ({ ...prev, [ing.id]: suggested.toString() }))}
                                                    title="Click para autocompletar"
                                                    style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid var(--border)', padding: '0.4rem 0.8rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' }}>
                                                    {suggested} {displayMetric(ing.metric)}
                                                </button>
                                            </td>
                                            <td style={{ padding: '1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.1"
                                                        value={defrostQuantities[ing.id] || ''}
                                                        onChange={(e) => setDefrostQuantities(prev => ({ ...prev, [ing.id]: e.target.value }))}
                                                        style={{ width: '80px', padding: '0.6rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                                                    />
                                                    <span style={{ color: 'var(--text-secondary)' }}>{displayMetric(ing.metric)}</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                <button
                                                    disabled={completing === ing.id}
                                                    onClick={() => handleCompleteDefrost(ing)}
                                                    className="btn-primary"
                                                    style={{ padding: '0.6rem 1rem', background: completing === ing.id ? 'var(--text-secondary)' : '#3b82f6', opacity: (!globalDefrostCook || !defrostQuantities[ing.id]) ? 0.5 : 1 }}>
                                                    {completing === ing.id ? 'Procesando...' : 'Completar'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const renderRecurringPrep = () => {
        // Group and sort prep items for dropdown
        const groupedItems: Record<string, any[]> = {};
        prepItems.forEach(item => {
            const cat = item.category?.name || 'Uncategorized';
            if (cat.toLowerCase().includes('descongelar')) return;
            if (!groupedItems[cat]) groupedItems[cat] = [];
            groupedItems[cat].push(item);
        });

        const sortedCats = Object.keys(groupedItems).sort((a, b) => a.localeCompare(b));
        sortedCats.forEach(cat => {
            groupedItems[cat].sort((a, b) => a.name.localeCompare(b.name));
        });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('PrepSchedule.recurring_desc')}</p>
                    <button className="btn-primary" onClick={() => setShowRecurringForm(!showRecurringForm)} style={{ padding: '0.6rem 1.2rem', borderRadius: '12px' }}>
                        {showRecurringForm ? 'Cancel' : t('PrepSchedule.new_recurring')}
                    </button>
                </div>

                {showRecurringForm && (
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 2, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Prep Task</label>
                            <select value={newRecurringTask} onChange={(e) => setNewRecurringTask(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                                <option value="">Select Task...</option>
                                {sortedCats.map(cat => (
                                    <optgroup key={cat} label={cat}>
                                        {groupedItems[cat].map(item => (
                                            <option key={item.id} value={item.id}>{item.name}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                        <div style={{ flex: 2, minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Insumo Base (Ingredient)</label>
                            <select value={newRecurringBase} onChange={(e) => setNewRecurringBase(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                                <option value="">Select Base...</option>
                                {baseIngredients.map(item => (
                                    <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                            </select>
                        </div>
                        <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Día de la Semana' : 'Day of Week'}</label>
                            <select value={newRecurringDay} onChange={(e) => setNewRecurringDay(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                                <option value="0">Sunday</option>
                                <option value="1">Monday</option>
                                <option value="2">Tuesday</option>
                                <option value="3">Wednesday</option>
                                <option value="4">Thursday</option>
                                <option value="5">Friday</option>
                                <option value="6">Saturday</option>
                            </select>
                            {newRecurringDay === '1' && <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginTop: '0.2rem' }}>Cubre: Mar, Mié, Jue, Vie</span>}
                            {newRecurringDay === '3' && <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginTop: '0.2rem' }}>Cubre: Sáb, Dom, Lun</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: '120px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Demanda Total (Porciones)' : 'Total Demand (Portions)'}</label>
                            <input type="number" step="0.01" min="0" value={newRecurringAmount} onChange={(e) => setNewRecurringAmount(e.target.value)} placeholder="0.0" style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                        </div>
                        <button className="btn-primary" onClick={handleCreateRecurringRule} style={{ padding: '0.8rem 1.5rem', borderRadius: '8px', height: 'fit-content', background: 'linear-gradient(135deg, #a855f7, #6b21a8)' }}>
                            {locale === 'es' ? 'Guardar Regla' : 'Save Rule'}
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
                                    <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
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
    };

    const renderCompletedLogs = () => {
        const sortedLogs = [...completedLogs].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

        const groupedLogs = sortedLogs.reduce((acc, log: any) => {
            const dateObj = new Date(log.completedAt);
            const rawMonthStr = dateObj.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', { month: 'long', year: 'numeric' });
            const monthYear = rawMonthStr.charAt(0).toUpperCase() + rawMonthStr.slice(1);

            const rawDayStr = dateObj.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
            const dayStr = rawDayStr.charAt(0).toUpperCase() + rawDayStr.slice(1);

            if (!acc[monthYear]) acc[monthYear] = {};
            if (!acc[monthYear][dayStr]) acc[monthYear][dayStr] = [];

            acc[monthYear][dayStr].push(log);
            return acc;
        }, {} as Record<string, Record<string, typeof completedLogs>>);

        const monthKeys = Object.keys(groupedLogs);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>View a historical log of completed prep duties and assignments.</p>
                </div>
                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
                ) : completedLogs.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                        <p>No completed logs found.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {monthKeys.map((monthYear, mIdx) => {
                            const days = groupedLogs[monthYear];
                            const dayKeys = Object.keys(days);
                            const totalLogsInMonth = dayKeys.reduce((sum, day) => sum + days[day].length, 0);

                            return (
                                <details key={monthYear} open={mIdx === 0} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                    <summary style={{ padding: '1rem 1.5rem', cursor: 'pointer', fontWeight: 600, fontSize: '1.2rem', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                            <Calendar size={18} color="var(--accent-primary)" />
                                            <span>{monthYear}</span>
                                        </div>
                                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 'normal', background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.6rem', borderRadius: '12px' }}>{totalLogsInMonth} {locale === 'es' ? 'tareas' : 'tasks'}</span>
                                    </summary>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
                                        {dayKeys.map((dayStr, dIdx) => (
                                            <details key={dayStr} open={mIdx === 0 && dIdx === 0} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border)', marginLeft: '1rem', overflow: 'hidden' }}>
                                                <summary style={{ padding: '0.8rem 1.2rem', cursor: 'pointer', fontWeight: 500, fontSize: '1rem', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ color: 'var(--text-primary)' }}>{dayStr}</span>
                                                    </div>
                                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{days[dayStr].length} {locale === 'es' ? 'tareas' : 'tasks'}</span>
                                                </summary>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
                                                    {days[dayStr].map((log: any) => (
                                                        <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
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
                                                                    {new Date(log.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        ))}
                                    </div>
                                </details>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

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
    const [newTaskMetric, setNewTaskMetric] = useState('units');
    const [newTaskSubtract, setNewTaskSubtract] = useState(false);
    const [newTaskRecipeId, setNewTaskRecipeId] = useState('');
    const [showAddTaskModal, setShowAddTaskModal] = useState(false);
    const [isManageOptionsOpen, setIsManageOptionsOpen] = useState(false);
    const [taskSearchQuery, setTaskSearchQuery] = useState('');

    const [showEditTaskModal, setShowEditTaskModal] = useState(false);
    const [editingTask, setEditingTask] = useState<any>(null);
    const [editTaskName, setEditTaskName] = useState('');
    const [editTaskCatId, setEditTaskCatId] = useState('');
    const [editTaskParentId, setEditTaskParentId] = useState('');
    const [editTaskMetric, setEditTaskMetric] = useState('units');
    const [editTaskSubtract, setEditTaskSubtract] = useState(false);
    const [editTaskRecipeId, setEditTaskRecipeId] = useState('');

    const handleAddPrepTask = async () => {
        if (!newTaskName) return alert("Enter task name");
        if (!newTaskCatId) return alert("Select a Category");
        setIsLoading(true);
        await addPrepTaskItem(newTaskName, newTaskCatId, newTaskMetric, newTaskParentId || undefined, newTaskSubtract, newTaskRecipeId || undefined);
        setPrepItems(await getPrepTaskItems());
        setNewTaskName('');
        setNewTaskCatId('');
        setNewTaskParentId('');
        setNewTaskMetric('units');
        setNewTaskSubtract(false);
        setNewTaskRecipeId('');
        setShowAddTaskModal(false);
        setIsLoading(false);
    };

    const handleOpenEditTask = (task: any) => {
        setEditingTask(task);
        setEditTaskName(task.name);
        setEditTaskCatId(task.categoryId);
        setEditTaskParentId(task.parentId || '');
        setEditTaskMetric(task.metric || 'units');
        setEditTaskSubtract(task.subtractFromInventory || false);
        setEditTaskRecipeId(task.digitalRecipeId || '');
        setShowEditTaskModal(true);
    };

    const handleSaveEditTask = async () => {
        if (!editTaskName) return alert("Enter task name");
        if (!editTaskCatId) return alert("Select a Category");
        setIsLoading(true);
        await editPrepTaskItem(editingTask.id, editTaskName, editTaskCatId, editTaskMetric, editTaskParentId || undefined, editTaskSubtract, editTaskRecipeId || undefined);
        setPrepItems(await getPrepTaskItems());
        setShowEditTaskModal(false);
        setEditingTask(null);
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
        const query = taskSearchQuery.toLowerCase().trim();
        const grouped: Record<string, Record<string, any[]>> = {};
        prepItems.forEach(item => {
            const cat = item.category?.name || 'Uncategorized';
            let parent = item.parent?.name || 'Base Tasks';
            // Explicitly classify 'Descongelar' without parent as belonging directly to the 'Descongelar Tasks' group to stand out
            if (cat === 'Descongelar' && !item.parentId) {
                parent = 'Descongelar Tasks';
            }

            if (query) {
                const matchesItem = item.name.toLowerCase().includes(query);
                const matchesParent = parent.toLowerCase().includes(query);
                if (!matchesItem && !matchesParent) return;
            }

            if (!grouped[cat]) grouped[cat] = {};
            if (!grouped[cat][parent]) grouped[cat][parent] = [];
            grouped[cat][parent].push(item);
        });

        return (
            <div style={{ display: 'flex', gap: '2rem' }}>
                <div className="glass-panel" style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.8rem' }}><Layers size={20} color="#a855f7" /> {locale === 'es' ? 'Tareas de Prep Elegibles' : 'Eligible Prep Tasks'}</h3>
                        
                        <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <div style={{ position: 'relative', flex: 1, maxWidth: '300px' }}>
                                <Search size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                                <input 
                                    type="text" 
                                    placeholder="Search base or task..." 
                                    value={taskSearchQuery}
                                    onChange={(e) => setTaskSearchQuery(e.target.value)}
                                    style={{ width: '100%', padding: '0.5rem 2rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', height: '36px' }}
                                />
                                {taskSearchQuery && (
                                    <button onClick={() => setTaskSearchQuery('')} style={{ background: 'transparent', border: 'none', position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <button onClick={() => setIsManageOptionsOpen(true)} className="btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '8px', height: '36px', whiteSpace: 'nowrap' }}>
                                <Settings size={16} /> Manage Categories
                            </button>
                            <button onClick={() => setShowAddTaskModal(true)} className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', borderRadius: '8px', height: '36px', whiteSpace: 'nowrap' }}>
                                <Plus size={16} /> Add Task
                            </button>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ overflowX: 'auto', padding: 0, marginTop: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>{t('PrepSchedule.th_category')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>Base / {t('PrepSchedule.th_ingredient')}</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>{t('PrepSchedule.th_task')} / Metric</th>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>Actions</th>
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
                                                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                                                    {renderCat && <td rowSpan={catRows} style={{ padding: '1rem', verticalAlign: 'top', fontWeight: 'bold', borderRight: '1px solid var(--border)' }}>{catName}</td>}
                                                    {renderPar && <td rowSpan={parRows} style={{ padding: '1rem', verticalAlign: 'top', color: 'var(--text-secondary)', borderRight: '1px solid var(--border)' }}>{parentName}</td>}
                                                    <td style={{ padding: '0.8rem 1rem' }}>
                                                        <span style={{ fontSize: '0.95rem' }}>{t.name}</span>
                                                        <span style={{ marginLeft: '0.8rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>({t.metric})</span>
                                                    </td>
                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.8rem', alignItems: 'center' }}>
                                                            <button onClick={() => handleOpenEditTask(t)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }} title="Edit Task"><Pencil size={16} /></button>
                                                            <button onClick={() => handleRemovePrepTask(t.id, t._count.usedInPreps)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: t._count.usedInPreps > 0 ? 'var(--text-secondary)' : 'var(--danger)' }} title={t._count.usedInPreps > 0 ? "Cannot delete: currently used." : "Delete task"}><Trash2 size={16} /></button>
                                                        </div>
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

    const PrepRuleRow = ({ item, rules, level }: { item: any, rules: any[], level: number }) => {
        const rule = rules.find((r: any) => r.ingredientId === item.id && r.ruleType === 'REGULAR');
        const [activeDays, setActiveDays] = useState<number[]>(rule ? rule.activeDays || [] : []);
        const [calcMode, setCalcMode] = useState(rule ? rule.calculationMode || 'ALGORITHM' : 'ALGORITHM');
        const [fixedAmount, setFixedAmount] = useState<string>(rule && rule.fixedAmount !== null ? rule.fixedAmount.toString() : '');
        const [triggerThreshold, setTriggerThreshold] = useState<string>(rule && rule.triggerThreshold !== null ? rule.triggerThreshold.toString() : '');
        const daysShort = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

        const hasChanges = () => {
            if (!rule && activeDays.length === 0) return false;
            // Simplified check to show save button (you could make it deeper if needed)
            return true;
        };

        const handleSave = async () => {
            const parsedAmount = parseFloat(fixedAmount);
            const parsedTrigger = parseFloat(triggerThreshold);
            await createOrUpdatePrepRule({
                ingredientId: item.id,
                ruleType: 'REGULAR',
                activeDays: activeDays,
                calculationMode: calcMode,
                fixedAmount: isNaN(parsedAmount) ? null : parsedAmount,
                coverageDays: [1], // Default 1 for alg mode backwards compatibility
                emergencyDays: 3,
                emergencyThreshold: 1.5,
                triggerThreshold: isNaN(parsedTrigger) ? null : parsedTrigger
            });
            loadDataForTab('airtight');
        };

        // If item has a parent, use the parent's inventory total stock. Otherwise, use the item's total stock if it's a base ingredient itself.
        const activeInventory = item.parent ? item.parent.inventory : item.inventory;
        const currentStock = activeInventory ? (activeInventory.frozenQty + activeInventory.thawingQty) : 0;
        const displayMetric = item.parent ? item.parent.metric : item.metric;

        return (
            <tr style={{ background: level === 0 ? 'var(--bg-secondary)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.8rem 1rem', paddingLeft: level === 0 ? '1rem' : '3rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: level === 0 ? '600' : 'normal', color: 'var(--text-primary)' }}>{item.name}</span>
                        {level > 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>← {item.parent?.name}</span>}
                    </div>
                </td>
                <td style={{ padding: '0.8rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentStock}</span> {displayMetric}
                </td>
                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                    <input
                        type="number"
                        placeholder="Umbral"
                        value={triggerThreshold}
                        onChange={(e) => setTriggerThreshold(e.target.value)}
                        style={{
                            width: '70px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border)',
                            background: 'var(--bg-primary)', color: 'var(--text-primary)', textAlign: 'center'
                        }}
                    />
                </td>
                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'center' }}>
                        {daysShort.map((d, i) => (
                            <button
                                key={d}
                                onClick={() => setActiveDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}
                                style={{
                                    width: '28px', height: '28px', borderRadius: '50%', border: 'none', cursor: 'pointer',
                                    background: activeDays.includes(i) ? 'var(--accent-primary)' : 'var(--border)',
                                    color: activeDays.includes(i) ? 'white' : 'var(--text-secondary)',
                                    fontSize: '0.8rem', fontWeight: 'bold'
                                }}
                            >
                                {d}
                            </button>
                        ))}
                    </div>
                </td>
                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <input
                                type="checkbox"
                                checked={calcMode === 'ALGORITHM'}
                                onChange={(e) => setCalcMode(e.target.checked ? 'ALGORITHM' : 'MANUAL')}
                            /> Algoritmo
                        </label>
                        <input
                            type="number"
                            placeholder="Monto"
                            value={fixedAmount}
                            onChange={(e) => setFixedAmount(e.target.value)}
                            disabled={calcMode === 'ALGORITHM'}
                            style={{
                                width: '60px', padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border)',
                                background: calcMode === 'ALGORITHM' ? 'rgba(0,0,0,0.05)' : 'var(--bg-primary)'
                            }}
                        />
                    </div>
                </td>
                <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                    <button onClick={handleSave} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', opacity: hasChanges() ? 1 : 0.5 }}>
                        Guardar
                    </button>
                </td>
            </tr>
        );
    };

    const renderAirTightRules = () => {
        // Group by Categoría
        const grouped: Record<string, Record<string, any[]>> = {};
        prepItems.forEach(item => {
            const catName = item.category?.name || 'Comunes';
            const parentName = item.parent?.name || 'Top Level';
            if (!grouped[catName]) grouped[catName] = {};
            if (!grouped[catName][parentName]) grouped[catName][parentName] = [];
            grouped[catName][parentName].push(item);
        });

        // Helper to quickly apply rule setting to all inside category
        const handleCategoryApplyAll = async (catName: string, categoryId: string) => {
            if (!confirm(`Apply [Mo, Tu, We, Th, Fr, Sa, Su] Algoritmo rules to all under ${catName}?`)) return;
            const res = await applyRulesToCategory(categoryId, {
                activeDays: [0, 1, 2, 3, 4, 5, 6],
                calculationMode: 'ALGORITHM',
                fixedAmount: null,
                coverageDays: [1]
            });
            if (res.success) {
                loadDataForTab('airtight');
            }
        };

        return (
            <MatrixErrorBoundary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Matriz de Reglas - Configuración Avanzada</p>
                    </div>

                    {isLoading ? (
                        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('PrepSchedule.loading')}</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            {Object.keys(grouped).sort().map(catName => {
                                const parents = grouped[catName];
                                // Get category ID roughly from first item to pass to mass action
                                const sampleItem = Object.values(parents)[0][0];
                                const categoryId = sampleItem?.categoryId;

                                return (
                                    <div key={catName} className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                                            <h3 style={{ margin: 0, fontWeight: 600 }}>{catName}</h3>
                                            {categoryId && (
                                                <button onClick={() => handleCategoryApplyAll(catName, categoryId)} className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
                                                    Aplicar Diario/Algoritmo a Todo
                                                </button>
                                            )}
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ background: 'rgba(255,255,255,0.02)', textAlign: 'left', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                        <th style={{ padding: '0.8rem 1rem' }}>Insumo</th>
                                                        <th style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>Stock Total</th>
                                                        <th style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>Umbral (Min Stock)</th>
                                                        <th style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>{t('Nav.sales') === 'Ventas' ? 'Ventana de Producción' : 'Production Window'}</th>
                                                        <th style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>Cálculo</th>
                                                        <th style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {Object.keys(parents).sort().map(parentName => {
                                                        const items = parents[parentName] || [];
                                                        if (!items || items.length === 0) return null;

                                                        // Map top level if present
                                                        const topLevel = items.find(i => i?.parentId === null || i?.name === parentName) || items[0];
                                                        if (!topLevel) return null;

                                                        const children = items.filter(i => i?.id !== topLevel?.id);

                                                        return (
                                                            <React.Fragment key={`group-${parentName}`}>
                                                                {topLevel && <PrepRuleRow item={topLevel} rules={airTightRules || []} level={0} />}
                                                                {children?.map(child => (
                                                                    child && <PrepRuleRow key={child.id} item={child} rules={airTightRules || []} level={1} />
                                                                ))}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </MatrixErrorBoundary>
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
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)' }}>
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
                        onClick={() => setActiveTab('defrosting')}
                        style={{ flex: 1, padding: '1.2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', borderBottom: activeTab === 'defrosting' ? '2px solid #3b82f6' : '2px solid transparent', color: activeTab === 'defrosting' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: activeTab === 'defrosting' ? 600 : 400, fontSize: '1.1rem', cursor: 'pointer', transition: 'all 0.2s' }}>
                        <Snowflake size={20} color={activeTab === 'defrosting' ? '#3b82f6' : 'inherit'} />
                        Estación de Descongelado
                    </button>
                    {isAdmin && (
                        <>
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
                        </>
                    )}
                </div>

                {/* Tab Output Section */}
                <div style={{ padding: '2rem' }}>
                    {activeTab === 'morning' && renderMorningPrep()}
                    {activeTab === 'night' && renderNightShift()}
                    {activeTab === 'recurring' && renderAirTightRules()}
                    {activeTab === 'completed' && renderCompletedLogs()}
                    {activeTab === 'team' && renderTeamAndTasks()}
                    {activeTab === 'defrosting' && renderDefrostingStation()}
                </div>

            </div>

            {/* DELETE MODAL */}
            {deleteTaskCandidate && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
                    zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
                }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '2rem', borderRadius: '12px', width: '400px', maxWidth: '100%', border: '1px solid var(--border)' }}>
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

            {/* ADD TASK MODAL */}
            {showAddTaskModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '2rem', borderRadius: '12px', width: '500px', maxWidth: '100%', border: '1px solid var(--border)' }}>
                        <h3 style={{ margin: '0 0 1.5rem 0' }}>Add New Task</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{locale === 'es' ? 'Nombre de la Tarea' : 'Task Name'}</label>
                                <input type="text" placeholder="e.g. Cortar Cebolla" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Category</label>
                                <SearchableSelect
                                    value={newTaskCatId}
                                    onChange={(val) => setNewTaskCatId(val)}
                                    options={[{ value: '', label: '-- Select Category --' }, ...[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: c.name }))]}
                                    placeholder="-- Select Category --"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{locale === 'es' ? 'Enlace a Ingrediente Base (Opcional)' : 'Base Ingredient Link (Optional)'}</label>
                                <SearchableSelect
                                    value={newTaskParentId}
                                    onChange={(val) => setNewTaskParentId(val)}
                                    options={[{ value: '', label: '-- None --' }, ...[...baseIngredients].sort((a, b) => a.name.localeCompare(b.name)).map(b => ({ value: b.id, label: b.name }))]}
                                    placeholder="-- None --"
                                />
                            </div>

                            <div>
                                <label style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <BookOpen size={16} color="var(--accent-primary)" />
                                    {locale === 'es' ? 'Vincular con Receta (Aparecerá en Preparaciones)' : 'Link to Recipe Book'}
                                </label>
                                <SearchableSelect
                                    value={newTaskRecipeId}
                                    onChange={(val) => setNewTaskRecipeId(val)}
                                    options={[{ value: '', label: '-- None --' }, ...[...digitalRecipes].sort((a, b) => a.name.localeCompare(b.name)).map(r => ({ value: r.id, label: `${r.recipeCode} - ${r.name}` }))]}
                                    placeholder="-- None --"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{locale === 'es' ? 'Unidad / Métrica' : 'Unit / Metric'}</label>
                                <select value={newTaskMetric} onChange={e => setNewTaskMetric(e.target.value)} disabled={!!newTaskParentId} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: newTaskParentId ? 'rgba(255,255,255,0.05)' : 'var(--bg-secondary)', color: newTaskParentId ? 'var(--text-secondary)' : 'var(--text-primary)', border: '1px solid var(--border)' }}>
                                    <option value="units">units</option>
                                    <option value="Lbs">Lbs</option>
                                    <option value="oz">oz</option>
                                    <option value="kilogramos (kg)">kilogramos (kg)</option>
                                    <option value="Grams">Grams</option>
                                    <option value="Pound">Pound</option>
                                    <option value="liters">liters</option>
                                    <option value="gallons">gallons</option>
                                </select>
                            </div>

                            {newTaskParentId && (
                                <div>
                                    {categories.find(c => c.id === newTaskCatId)?.name === 'Descongelar' ? (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'not-allowed', color: 'var(--accent-primary)' }}>
                                            <input
                                                type="checkbox"
                                                checked={true}
                                                readOnly
                                                style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--accent-primary)' }}
                                            />
                                            {locale === 'es' ? 'Descongelar (Mueve a Descongelados, no resta inventario)' : 'Defrost (Moves to Unfrozen, does not reduce inventory)'}
                                        </label>
                                    ) : (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                            <input
                                                type="checkbox"
                                                checked={newTaskSubtract}
                                                onChange={(e) => setNewTaskSubtract(e.target.checked)}
                                                style={{ width: '1.2rem', height: '1.2rem' }}
                                            />
                                            {locale === 'es' ? 'Restar del Inventario al Completar' : 'Subtract from Inventory on Completion'}
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
                            <button onClick={() => setShowAddTaskModal(false)} className="btn-secondary">{locale === 'es' ? 'Cancelar' : 'Cancel'}</button>
                            <button onClick={handleAddPrepTask} className="btn-primary">Save Task</button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT TASK MODAL */}
            {showEditTaskModal && editingTask && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '2rem', borderRadius: '12px', width: '500px', maxWidth: '100%', border: '1px solid var(--border)' }}>
                        <h3 style={{ margin: '0 0 1.5rem 0' }}>{locale === 'es' ? 'Editar Tarea' : 'Edit Task'}</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{locale === 'es' ? 'Nombre de la Tarea' : 'Task Name'}</label>
                                <input type="text" value={editTaskName} onChange={e => setEditTaskName(e.target.value)} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Category</label>
                                <SearchableSelect
                                    value={editTaskCatId}
                                    onChange={(val) => setEditTaskCatId(val)}
                                    options={[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: c.name }))}
                                    placeholder="-- Select Category --"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{locale === 'es' ? 'Enlace a Ingrediente Base (Opcional)' : 'Base Ingredient Link (Optional)'}</label>
                                <SearchableSelect
                                    value={editTaskParentId}
                                    onChange={(val) => setEditTaskParentId(val)}
                                    options={[{ value: '', label: '-- None --' }, ...[...baseIngredients].sort((a, b) => a.name.localeCompare(b.name)).map(b => ({ value: b.id, label: b.name }))]}
                                    placeholder="-- None --"
                                />
                            </div>

                            <div>
                                <label style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <BookOpen size={16} color="var(--accent-primary)" />
                                    {locale === 'es' ? 'Vincular con Receta (Aparecerá en Preparaciones)' : 'Link to Recipe Book'}
                                </label>
                                <SearchableSelect
                                    value={editTaskRecipeId}
                                    onChange={(val) => setEditTaskRecipeId(val)}
                                    options={[{ value: '', label: '-- None --' }, ...[...digitalRecipes].sort((a, b) => a.name.localeCompare(b.name)).map(r => ({ value: r.id, label: `${r.recipeCode} - ${r.name}` }))]}
                                    placeholder="-- None --"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{locale === 'es' ? 'Unidad / Métrica' : 'Unit / Metric'}</label>
                                <select value={editTaskMetric} onChange={e => setEditTaskMetric(e.target.value)} disabled={!!editTaskParentId} style={{ width: '100%', padding: '0.8rem', borderRadius: '8px', background: editTaskParentId ? 'rgba(255,255,255,0.05)' : 'var(--bg-secondary)', color: editTaskParentId ? 'var(--text-secondary)' : 'var(--text-primary)', border: '1px solid var(--border)' }}>
                                    <option value="units">units</option>
                                    <option value="Lbs">Lbs</option>
                                    <option value="oz">oz</option>
                                    <option value="kilogramos (kg)">kilogramos (kg)</option>
                                    <option value="Grams">Grams</option>
                                    <option value="Pound">Pound</option>
                                    <option value="liters">liters</option>
                                    <option value="gallons">gallons</option>
                                </select>
                            </div>

                            {editTaskParentId && (
                                <div>
                                    {categories.find(c => c.id === editTaskCatId)?.name === 'Descongelar' ? (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'not-allowed', color: 'var(--accent-primary)' }}>
                                            <input
                                                type="checkbox"
                                                checked={true}
                                                readOnly
                                                style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--accent-primary)' }}
                                            />
                                            {locale === 'es' ? 'Descongelar (Mueve a Descongelados, no resta inventario)' : 'Defrost (Moves to Unfrozen, does not reduce inventory)'}
                                        </label>
                                    ) : (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                            <input
                                                type="checkbox"
                                                checked={editTaskSubtract}
                                                onChange={(e) => setEditTaskSubtract(e.target.checked)}
                                                style={{ width: '1.2rem', height: '1.2rem' }}
                                            />
                                            {locale === 'es' ? 'Restar del Inventario al Completar' : 'Subtract from Inventory on Completion'}
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem' }}>
                            <button onClick={() => { setShowEditTaskModal(false); setEditingTask(null); }} className="btn-secondary">{locale === 'es' ? 'Cancelar' : 'Cancel'}</button>
                            <button onClick={handleSaveEditTask} className="btn-primary">{locale === 'es' ? 'Guardar Cambios' : 'Save Changes'}</button>
                        </div>
                    </div>
                </div>
            )}

            <ManageOptionsModal
                isOpen={isManageOptionsOpen}
                onClose={() => {
                    setIsManageOptionsOpen(false);
                    loadDataForTab('team');
                }}
                categoryType="TASK"
            />
            {/* RECIPE VIEW MODAL */}
            {viewingRecipeId && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '2rem', borderRadius: '12px', width: '800px', maxWidth: '100%', border: '1px solid var(--border)', maxHeight: '90vh', overflowY: 'auto' }}>
                        {(() => {
                            const recipe = digitalRecipes.find(r => r.id === viewingRecipeId);
                            if (!recipe) return <div style={{ textAlign: 'center' }}>Cargando Receta...</div>;

                            let items = [];
                            try { items = typeof recipe.ingredients === 'string' ? JSON.parse(recipe.ingredients) : recipe.ingredients; } catch (e) { }

                            let steps = [];
                            try { steps = typeof recipe.procedure === 'string' ? JSON.parse(recipe.procedure) : recipe.procedure; } catch (e) { }

                            return (
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <h2 style={{ margin: 0 }}>{recipe.name}</h2>
                                                <span style={{ background: 'rgba(255,255,255,0.1)', padding: '0.3rem 0.8rem', borderRadius: '20px', fontSize: '0.8rem' }}>{recipe.recipeCode}</span>
                                            </div>
                                            {recipe.yieldInfo && <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.5rem', display: 'block' }}>Rendimiento: {recipe.yieldInfo}</span>}
                                        </div>
                                        <button onClick={() => setViewingRecipeId(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
                                    </div>

                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{recipe.overview || 'Sin descripción general.'}</p>

                                    <h4 style={{ marginBottom: '1rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Ingredientes</h4>
                                    <table style={{ width: '100%', marginBottom: '2rem', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                                                <th style={{ padding: '0.5rem' }}>Ingrediente</th>
                                                <th style={{ padding: '0.5rem' }}>Cantidad</th>
                                                <th style={{ padding: '0.5rem' }}>Notas</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((it: any, i: number) => (
                                                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ padding: '0.5rem' }}>{it.name}</td>
                                                    <td style={{ padding: '0.5rem', color: 'var(--accent-primary)' }}>{it.qty} {it.unit}</td>
                                                    <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{it.notes}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    <h4 style={{ marginBottom: '1rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Procedimiento</h4>
                                    <div style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                        {steps.map((st: any, i: number) => (
                                            <div key={i} style={{ display: 'flex', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                                <div style={{ fontWeight: 'bold', color: 'var(--accent-primary)' }}>{i + 1}.</div>
                                                <div style={{ lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{st.text}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {recipe.chefNotes && (
                                        <>
                                            <h4 style={{ marginBottom: '1rem', color: 'var(--warning)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>Notas del Chef</h4>
                                            <div style={{ background: 'rgba(245, 158, 11, 0.05)', padding: '1.5rem', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                                                {recipe.chefNotes}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
}
