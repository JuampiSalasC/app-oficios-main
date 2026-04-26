from pydantic import BaseModel
from typing import Optional, List

class UsuarioRegistro(BaseModel):
    id: str
    nombre: str
    tipo: str  # "cliente" o "profesional"
    zonas: Optional[List[str]] = None
    categorias: Optional[List[str]] = []
    subcategorias: Optional[List[str]] = None
    foto: Optional[str] = None
    descripcion: Optional[str] = ""
    disponibilidad: Optional[str] = ""
    status: str = "ACTIVE"
    telefono: Optional[str] = None

class UsuarioUpdate(BaseModel):
    id: Optional[str]
    nombre: Optional[str]
    tipo: Optional[str]
    zonas: Optional[List[str]] = None
    categorias: Optional[List[str]] = []
    subcategorias: Optional[List[str]] = None
    foto: Optional[str] = None
    descripcion: Optional[str] = ""
    disponibilidad: Optional[str] = ""
    telefono: Optional[str] = None
    