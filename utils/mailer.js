// BACKEND/utils/mailer.js
import nodemailer from 'nodemailer';

// Configuración del servicio de correo (Usando Gmail como ejemplo)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'anayawilliam421@gmail.com', // <--- CAMBIA ESTO POR TU CORREO
    pass: 'bjsd rxqk uduf fucb'       // <--- CAMBIA ESTO POR TU CONTRASEÑA DE APLICACIÓN DE GMAIL
  }
});

export const sendAccessCode = async (email, code, name) => {
  const mailOptions = {
    from: '"Sistema Nacional de Salud" <no-reply@salud.gov.co>',
    to: email,
    subject: '✅ Aprobación de Solicitud - Cuidador',
    html: `
      <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
        <h2 style="color: #4F46E5;">¡Solicitud Aprobada!</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>La EPS ha revisado y aprobado tu solicitud para ser Cuidador.</p>
        <p>Para completar tu registro, ingresa al sistema y usa el siguiente código de acceso:</p>

        <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #000;">${code}</span>
        </div>

        <p>Este código es de uso único y personal.</p>
        <hr>
        <p style="font-size: 12px; color: #666;">Si no solicitaste esto, ignora este mensaje.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Correo enviado a ${email}`);
    return true;
  } catch (error) {
    console.error("Error enviando correo:", error);
    return false;
  }
};