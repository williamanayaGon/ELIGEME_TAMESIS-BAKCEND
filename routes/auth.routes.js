import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();
const SECRET_KEY = 'secreto_super_seguro'; // En prod usa variables de entorno

// REGISTRO
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, fullName }
    });

    res.json({ message: 'Usuario creado', user });
  } catch (error) {
    res.status(400).json({ error: 'El correo ya está registrado' });
  }
});

// LOGIN (AQUÍ ESTABA EL FALLO)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '1h' });

    // 👇👇👇 AQUÍ AGREGAMOS "role" y "professionalId" PARA QUE EL FRONTEND LOS VEA 👇👇👇
    res.json({
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,           // <--- ¡ESTO FALTABA!
        professionalId: user.professionalId // <--- ESTO TAMBIÉN ES IMPORTANTE
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

export default router;