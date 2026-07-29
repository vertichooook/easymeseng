const form = document.querySelector('form');
const notice = document.querySelector('#notice');
const mode = form.id === 'registerForm' ? 'register' : 'login';

function show(message, bad = false) {
  notice.textContent = message;
  notice.className = `notice ${bad ? 'bad' : 'good'}`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Ошибка запроса.');
    show('Готово, открываем чат...');
    location.href = '/';
  } catch (error) {
    show(error.message, true);
  }
});
