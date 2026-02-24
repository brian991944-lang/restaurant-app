'use server'

import prisma from '@/lib/prisma'

export async function getDropdownOptions(group: string) {
    try {
        const options = await prisma.dropdownOption.findMany({
            where: { group },
            orderBy: { createdAt: 'asc' }
        })
        return options
    } catch (error) {
        console.error('Failed to fetch options for group:', group, error)
        return []
    }
}

export async function addDropdownOption(group: string, name: string, isTranslated: boolean, nameEs?: string) {
    try {
        const newOption = await prisma.dropdownOption.create({
            data: {
                group,
                name,
                nameEs: isTranslated ? null : (nameEs || null),
                isTranslated
            }
        })
        return { success: true, option: newOption }
    } catch (error) {
        console.error('Failed to create option:', error)
        return { success: false, error: 'Failed to create option' }
    }
}

export async function editDropdownOption(id: string, name: string, isTranslated: boolean, nameEs?: string) {
    try {
        const option = await prisma.dropdownOption.update({
            where: { id },
            data: {
                name,
                isTranslated,
                nameEs: isTranslated ? null : (nameEs || null)
            }
        })
        return { success: true, option }
    } catch (error) {
        console.error('Failed to edit option:', error)
        return { success: false, error: 'Failed to edit option' }
    }
}

export async function deleteDropdownOption(id: string) {
    try {
        await prisma.dropdownOption.delete({
            where: { id }
        })
        return { success: true }
    } catch (error) {
        console.error('Failed to delete option:', error)
        return { success: false, error: 'Failed to delete option' }
    }
}
