import type { ReactElement } from 'react';
import Link from 'next/link';
import { UploadForm } from './upload-form';

export default function HomePage(): ReactElement {
  return (
    <main className="page-shell">
      <section className="panel">
        <p className="eyebrow">Image Moderation · локальный MVP</p>
        <h1>Проверка изображений</h1>
        <p className="intro">Загрузите JPEG, PNG или WebP. Файл будет сохранён приватно и пройдет начальную модерацию.</p>
        <UploadForm />
        <p className="footnote">Результат появится после завершения проверки. <Link href="/admin/login">Вход в панель модерации</Link></p>
      </section>
    </main>
  );
}
