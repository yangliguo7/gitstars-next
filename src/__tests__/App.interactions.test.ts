import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from '../App.vue'

describe('App interactions', () => {
  it('keeps empty state when switching to ungrouped before login', async () => {
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await wrapper.findAll('.navitem').find((button) => button.text().includes('Ungrouped'))?.trigger('click')
    expect(wrapper.text()).toContain('Connect GitHub to start.')
    expect(wrapper.findAll('.repo-card').length).toBe(0)
  })

  it('supports command palette dark mode command', async () => {
    const wrapper = mount(App, { attachTo: document.body, global: { plugins: [createPinia()] } })
    await wrapper.find('.footbtn').trigger('click')
    const input = wrapper.find('.palette-input input')
    await input.setValue('dark mode')
    await input.trigger('keydown.enter')
    expect(document.documentElement.dataset.theme).toBe('dark')
    wrapper.unmount()
  })
})
