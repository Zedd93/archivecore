type RequesterAction = 'addItem' | 'submit' | 'cancel';

export function assertDepartmentRequesterAction(
  order: { requestedBy: string; status: string },
  userId: string,
  action: RequesterAction,
): void {
  if (order.requestedBy !== userId) {
    throw Object.assign(new Error('Tylko autor zlecenia może wykonać tę operację'), { statusCode: 403 });
  }
  if (action === 'addItem' && order.status !== 'draft') {
    throw Object.assign(new Error('Pracownik może zmieniać pozycje tylko we własnym szkicu'), { statusCode: 403 });
  }
  if (action === 'cancel' && !['draft', 'submitted'].includes(order.status)) {
    throw Object.assign(new Error('Po zatwierdzeniu zlecenie może anulować tylko osoba uprawniona do jego obsługi'), { statusCode: 403 });
  }
}
