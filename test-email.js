import nodemailer from 'nodemailer';

// 👇 PON TUS DATOS AQUÍ PARA PROBAR
const USER = 'anayawilliam421@gmail.com';
const PASS = 'bjsd rxqk uduf fucb'; // Tu contraseña de aplicación de 16 letras

async function main() {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: USER, pass: PASS }
  });

  try {
    const info = await transporter.verify();
    console.log("✅ CONEXIÓN EXITOSA: Tus credenciales están perfectas.");

    await transporter.sendMail({
      from: USER,
      to: USER, // Te lo envías a ti mismo
      subject: "Prueba de Nodemailer",
      text: "Si lees esto, el correo funciona."
    });
    console.log("📧 Correo de prueba enviado.");

  } catch (error) {
    console.log("❌ ERROR DE AUTENTICACIÓN:");
    console.error(error);
  }
}

main();