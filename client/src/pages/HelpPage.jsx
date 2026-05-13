import { useParams } from 'react-router-dom'
import HelpLayout from '../help/HelpLayout'
import HelpContent from '../help/HelpContent'
import { TOPICS_BY_SLUG } from '../help/topicsIndex'

export default function HelpPage() {
  const { topicSlug } = useParams()
  const notFound = !!(topicSlug && !TOPICS_BY_SLUG[topicSlug])

  return (
    <HelpLayout activeSlug={topicSlug || null}>
      <HelpContent slug={topicSlug || null} notFound={notFound} />
    </HelpLayout>
  )
}
