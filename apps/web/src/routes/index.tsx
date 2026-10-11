import { createFileRoute } from '@tanstack/react-router'
import { LandingPage } from '@/features/landing/landing-page'

/**
 * Главная страница платформы. Вне обоих layout'ов: ни шапки кабинета, ни
 * узкой колонки страниц входа — своя сцена во весь экран. Сессию не
 * проверяет: вошедший видит ту же витрину с кнопкой «В кабинет».
 */
export const Route = createFileRoute('/')({
  component: LandingPage,
})
