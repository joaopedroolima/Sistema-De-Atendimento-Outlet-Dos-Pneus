// =========================================================================
// PUSH SIMPLIFICADO (SEM LIMPEZA PRÉVIA)
// =========================================================================

const VAPID_PUBLIC_KEY = 'BK6QJSF0wZwzNPkTDQLWENm-9HsYynNimRnye3F4RtSnxGWPjhxP8o9OZSpXKKzSQWvyt8GSz13HzKq7u4OV-KI'; 

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export async function registerForPushNotifications() {
  console.log('🏁 INICIANDO TENTATIVA DIRETA...');

  if (!('serviceWorker' in navigator)) return;

  try {
    // 1. Pede permissão
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.error('❌ Permissão negada.');
      return;
    }

    // 2. Aguarda o SW
    const registration = await navigator.serviceWorker.ready;
    console.log('✅ Service Worker pronto.');

    // 3. TENTA INSCREVER DIRETO (Sem verificar se já existe antes)
    console.log('🚀 Tentando inscrever agora...');
    
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    console.log('🎉 SUCESSO! Subscription:', subscription);

    // 4. Envia para o backend
    await fetch('https://detect-interaction-tax-cartridges.trycloudflare.com/save-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
    });
    console.log('✅ Enviado para o backend!');

  } catch (error) {
    console.error('❌ ERRO:', error);
  }
}