import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from '../App.vue'

describe('App', () => {
  it('renders GitStars loading real-data shell', () => {
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    expect(wrapper.text()).toContain('GitStars')
    expect(wrapper.text()).toContain('Connect GitHub to start.')
    expect(wrapper.text()).toContain('正在加载 Star Library')
    expect(wrapper.text()).toContain('Connect GitHub')
  })

  it('opens avatar settings menu with model settings entry', async () => {
    const wrapper = mount(App, { global: { plugins: [createPinia()] } })
    await wrapper.get('.avatarbtn').trigger('click')
    expect(wrapper.text()).toContain('Model Settings')
    await wrapper.get('.dropitem:nth-of-type(3)').trigger('click')
    expect(wrapper.text()).toContain('Base URL')
  })
})
