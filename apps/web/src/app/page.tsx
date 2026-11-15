import type { ReactElement } from 'react';
import { UploadForm } from './upload-form';

export default function HomePage(): ReactElement {
  return (
    <main className="page-shell">
      <section className="panel">
        <p className="eyebrow">Image Moderation · локальный MVP</p>
        <h1>Проверка изображений</h1>
        <p className="intro">Загрузите JPEG, PNG или WebP. Файл будет проверен, сохранён приватно и поставлен в очередь обработки.</p>
        <UploadForm />
        <p className="footnote">На этой фазе Worker принимает задание. Этапы AI-модерации добавляются следующей фазой.</p>
      </section>
    </main>
  );
}
